/**
 * `topics.subscribe` and `topics.unsubscribe` (spec section 5 "Subscribe
 * works on any thread"; architecture 4.4 and 5.7; ADR 0010).
 *
 * One command is three steps:
 * 1. one writer transaction that reads the state before the change, writes
 *    the new state and fires the keys the sidebar query listens to, so the
 *    row appears or leaves at once;
 * 2. for a thread, the mirror call to Slack through the `Outbox` seam
 *    (`subscriptions.thread.add` or `.remove` with `channel`, `thread_ts`
 *    and `last_read`, research section 3). Main has no Slack subscription:
 *    its flag is client-only and the command ends after step 1;
 * 3. on a failed mirror, a second transaction that puts the previous state
 *    back, then the typed error.
 *
 * The undo is computed from the state before the change: a change returns
 * the opposite command, no change returns nothing.
 *
 * Thread state is Slack's follow flag in `thread_subs`; Main state is
 * `topic_overlay.unsubscribed_at`. The pure rules in `@juno/domain` read
 * both (`isSubscribed`, `sidebarPlacement`).
 */
import { Clock, Effect } from 'effect'
import { NotFound, NotSignedIn, type CommandResult, type SubscribeError } from '@juno/contract'
import { parseTopicId, type Ts } from '@juno/domain'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import { clearThreadSub, readMessage, readState, setThreadSub, syncKeys, threadSub, type ThreadSubRow } from '@juno/sync'
import { Outbox } from '../outbox'
import { Workspace, type StoreServices } from '../workspace'

type Services = Workspace | Outbox

/** `topics.subscribe` when `subscribed`, `topics.unsubscribe` otherwise. */
export const setSubscribed = (id: string, subscribed: boolean): Effect.Effect<CommandResult, SubscribeError, Services> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const open = yield* workspace.current
    if (open === undefined) return yield* new NotSignedIn()
    const parsed = parseTopicId(id)
    if (parsed === undefined || parsed.kind === 'group') return yield* new NotFound({ kind: 'topic', id })
    // A store failure is a bug, not a state the user can act on (architecture 2.6).
    const local = <A>(effect: Effect.Effect<A, SqlError, StoreServices>): Effect.Effect<A> => effect.pipe(Effect.provide(open.context), Effect.orDie)
    const undo: CommandResult = { undo: { _tag: subscribed ? 'topics.unsubscribe' : 'topics.subscribe', id } }

    if (parsed.kind === 'main') {
      const changed = yield* local(transaction(setMainSubscribed(parsed.channel, id, subscribed)))
      if (changed === 'missing') return yield* new NotFound({ kind: 'topic', id })
      return changed ? undo : {}
    }

    const { channel, threadTs } = parsed
    const before = yield* local(transaction(setThreadSubscribed(channel, threadTs, id, subscribed)))
    if (before === 'missing') return yield* new NotFound({ kind: 'topic', id })
    if (before === 'unchanged') return {}

    const outbox = yield* Outbox
    const args = { channel, thread_ts: threadTs, ...(before.lastRead === undefined ? {} : { last_read: before.lastRead }) }
    yield* outbox
      .send((api) => api.call(subscribed ? 'subscriptions.thread.add' : 'subscriptions.thread.remove', args))
      .pipe(Effect.tapError(() => local(transaction(restoreThreadSub(channel, threadTs, before.previous)))))
    return undo
  })

/** The state a failed mirror call puts back, and the read pointer the mirror call sends. */
interface ThreadBefore {
  readonly previous: ThreadSubRow | undefined
  readonly lastRead: Ts | undefined
}

const setThreadSubscribed = (
  channel: string,
  threadTs: string,
  topicId: string,
  subscribed: boolean,
): Effect.Effect<ThreadBefore | 'missing' | 'unchanged', SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const root = yield* readMessage(channel, threadTs)
    if (root === undefined) return 'missing'
    const previous = yield* threadSub(channel, threadTs)
    if ((previous?.subscribed ?? false) === subscribed) return 'unchanged'
    yield* setThreadSub(channel, threadTs, subscribed, undefined)
    // Slack wants the thread's read pointer with a follow change: Juno's, else the latest reply (an unfollowed thread starts read there).
    const reads = yield* readState(topicId)
    const lastRead = (reads.lastReadTs ?? root.latest_reply ?? root.ts) as Ts
    return { previous, lastRead }
  })

const restoreThreadSub = (channel: string, threadTs: string, previous: ThreadSubRow | undefined): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  previous === undefined ? clearThreadSub(channel, threadTs) : setThreadSub(channel, threadTs, previous.subscribed, previous.slackLastRead)

/** Main's client-only flag. Returns whether anything changed, or `missing` for a conversation the store does not know. */
const setMainSubscribed = (channel: string, topicId: string, subscribed: boolean): Effect.Effect<boolean | 'missing', SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const known = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE id = ${channel}`
    if (known.length === 0) return 'missing'
    const rows = yield* sql<{ unsubscribed_at: string | null }>`SELECT unsubscribed_at FROM topic_overlay WHERE topic_id = ${topicId}`
    const current = rows[0]?.unsubscribed_at ?? null
    if ((current === null) === subscribed) return false
    const value = subscribed ? null : String(yield* Clock.currentTimeMillis)
    yield* sql`INSERT INTO topic_overlay (topic_id, unsubscribed_at) VALUES (${topicId}, ${value})
      ON CONFLICT (topic_id) DO UPDATE SET unsubscribed_at = excluded.unsubscribed_at`
    yield* Invalidation.use((i) => i.invalidate(syncKeys.overlay(topicId)))
    return true
  })
