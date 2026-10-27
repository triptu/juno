/**
 * Follow new threads (SPEC 5, "Which threads"): a setting of Juno's own on
 * a channel, DM or group DM. Slack has no such setting.
 *
 * - `channels.followNew` turns it on or off. `follow_new_threads` keeps the
 *   conversation with the time it was turned on (`since_ts`). The undo of
 *   turning it off puts that time back.
 * - `FollowNewJob` follows, in Slack, each thread of such a conversation
 *   whose root is newer than `since_ts`, once the root has a reply: a root
 *   without replies is part of Main, not a thread yet. It reads the store,
 *   so a thread seen live and one found by the catch-up after a restart are
 *   followed the same way. Each one goes through `setSubscribed` with
 *   `how: 'auto'`, which records it in `auto_followed` in the same
 *   transaction as the follow and follows only a thread Slack has said
 *   nothing about. So a thread is followed this way once, and an unfollow
 *   (Notify me Never, here or in Slack) is never overridden. The calls go
 *   one at a time on the background lane, so a busy channel does not burst
 *   Slack's rate limits.
 * - While the channel is ignored the setting does nothing: its new threads
 *   are recorded as done without a follow, so stopping the ignore does not
 *   follow them afterwards.
 * - Existing threads are not followed when it is turned on, and turning it
 *   off unfollows nothing.
 *
 * specs/follownew.qnt models these rules.
 */
import { Clock, Effect, Layer, Stream } from 'effect'
import { NotFound, NotSignedIn, type CommandResult, type TopicActionError } from '@juno/contract'
import { millisToTs } from '@juno/domain'
import { Invalidation, liveQuery, StoreReader, StoreWriter, transaction, type InvalidationKeys, type SqlError } from '@juno/store'
import { claimAutoFollow, setSubscribed } from './follow'
import { Outbox } from './outbox'
import { SyncLink } from './syncLink'
import { Workspace, type OpenWorkspace, type StoreServices } from './workspace'

/** While a conversation has the setting on, a pass runs when a message, the setting or the ignore list changes. */
const KEYS: InvalidationKeys = ['messages', 'follow_new_threads', 'ignored_channels']
/** Threads a pass reads at a time. */
const PASS_SIZE = 50

/** Turns Follow new threads on (from now, or from `since` for an undo) or off. */
export const setFollowNew = (channel: string, on: boolean, since?: string): Effect.Effect<CommandResult, TopicActionError, Workspace> =>
  Effect.gen(function* () {
    const open = yield* (yield* Workspace).current
    if (open === undefined) return yield* new NotSignedIn()
    const from = since ?? millisToTs(yield* Clock.currentTimeMillis)
    const undo = yield* transaction(
      Effect.gen(function* () {
        const sql = yield* StoreWriter
        if ((yield* sql`SELECT id FROM conversations WHERE id = ${channel}`).length === 0) return 'missing' as const
        const previous = (yield* sql<{ since_ts: string }>`SELECT since_ts FROM follow_new_threads WHERE channel = ${channel}`)[0]?.since_ts
        if (on === (previous !== undefined)) return undefined
        const invalidate = Invalidation.use((i) => i.invalidate(['follow_new_threads']))
        if (previous === undefined) {
          yield* sql`INSERT INTO follow_new_threads (channel, since_ts) VALUES (${channel}, ${from})`
          yield* invalidate
          return { _tag: 'channels.followNew', channel, on: false } as const
        }
        yield* sql`DELETE FROM follow_new_threads WHERE channel = ${channel}`
        yield* invalidate
        return { _tag: 'channels.followNew', channel, on: true, since: previous } as const
      }),
    ).pipe(Effect.provide(open.context), Effect.orDie)
    if (undo === 'missing') return yield* new NotFound({ kind: 'channel', id: channel })
    return undo === undefined ? {} : { undo }
  })

/** The conversations with the setting on, for the menus. */
export const followNewChannels: Effect.Effect<ReadonlyArray<string>, SqlError, StoreReader> = Effect.map(
  StoreReader.use((sql) => sql<{ channel: string }>`SELECT channel FROM follow_new_threads ORDER BY channel`),
  (rows) => rows.map((row) => row.channel),
)

interface Candidate {
  readonly channel: string
  readonly ts: string
  readonly ignored: number
}

/**
 * Roots with replies, newer than the setting, that Follow new threads has
 * not had its go at, oldest first. `reply_count > 0` lets it read the
 * `messages_thread_roots` index.
 */
export const candidatesStatement = (limit: number) => ({
  sql: `SELECT m.channel, m.ts, ig.channel IS NOT NULL AS ignored
    FROM follow_new_threads f
    JOIN messages m ON m.channel = f.channel AND m.ts >= f.since_ts AND m.reply_count > 0
    LEFT JOIN auto_followed a ON a.channel = m.channel AND a.thread_ts = m.ts
    LEFT JOIN ignored_channels ig ON ig.channel = m.channel
    WHERE a.channel IS NULL
    ORDER BY m.ts LIMIT ?`,
  params: [limit] as ReadonlyArray<number>,
})

/** Follows every candidate, a page at a time, while the sync stays online. */
const runPass = (open: OpenWorkspace, online: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    const local = <A>(effect: Effect.Effect<A, SqlError, StoreServices>): Effect.Effect<A> => effect.pipe(Effect.provide(open.context), Effect.orDie)
    const statement = candidatesStatement(PASS_SIZE)
    while (yield* online) {
      const rows = yield* local(StoreReader.use((sql) => sql.unsafe<Candidate>(statement.sql, statement.params)))
      const ignored = rows.filter((row) => row.ignored === 1)
      if (ignored.length > 0) yield* local(transaction(Effect.forEach(ignored, (row) => claimAutoFollow(row.channel, row.ts), { discard: true })))
      yield* Effect.forEach(rows.filter((row) => row.ignored !== 1), (row) =>
        setSubscribed(`t:${row.channel}:${row.ts}`, true, 'auto').pipe(
          // A refused or lost call is settled by the follow command's own lookup; the thread has had its go.
          Effect.catch((error) => Effect.logWarning('follow new threads: a follow did not go through', { error: error._tag })),
        ), { discard: true })
      if (rows.length < PASS_SIZE) return
    }
  })

/**
 * Runs the job for the life of the engine, in the open workspace. It reads
 * nothing on new messages while no conversation has the setting on.
 */
export const FollowNewJob: Layer.Layer<never, never, Workspace | Outbox | SyncLink> = Layer.effectDiscard(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const sync = yield* SyncLink
    const pass = (open: OpenWorkspace) =>
      runPass(open, sync.online).pipe(
        Effect.provideService(Workspace, workspace),
        Effect.provideService(Outbox, outbox),
        Effect.catchCause((cause) => Effect.logError('follow new threads: a pass failed', { cause })),
      )
    yield* Effect.forkScoped(
      workspace.changes.pipe(
        Stream.switchMap((open) => {
          if (open === undefined) return Stream.empty
          const local = <A, E>(stream: Stream.Stream<A, E, StoreServices>) => stream.pipe(Stream.provide(open.context))
          return local(liveQuery(['follow_new_threads'], followNewChannels)).pipe(
            Stream.map((run) => run._tag === 'Success' && run.success.length > 0),
            Stream.changes,
            Stream.switchMap((on) => (on ? Stream.merge(local(liveQuery(KEYS, Effect.void)), sync.onlineChanges) : Stream.empty)),
            Stream.mapEffect(() => pass(open)),
          )
        }),
        Stream.runDrain,
      ),
    )
  }),
)
