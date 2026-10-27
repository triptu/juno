/**
 * The engine's `JunoHost` (`@juno/agent-juno`): what the AgentHost handlers
 * read and write, over the open workspace and the outbox (ADR 0012).
 *
 * - Reads use the open workspace's store (`reads.ts`); with none open they
 *   fail with `signedOut`.
 * - A send is queued as the composer queues one (`postQueue.ts`), with
 *   the action id as its `client_msg_id`, in the transaction that takes
 *   the owner's click and records the attempt. `PostWorker` posts it with
 *   the composer's rules, and `posted` waits for the row to settle.
 * - `sent` asks Slack, not the store, for the reconcile lookup.
 * - Spend asks come from `AiSpend`: the engine's model calls reserve and
 *   settle in the agent's daily cap.
 * - Presence follows the engine phase, the AI assist pref, the clock against
 *   the notification and active hours the notifications engine reads
 *   (`@juno/notifications` settings), and the topic last shown.
 */
import { Clock, Context, Effect, Layer, Option, Result, Stream, SubscriptionRef } from 'effect'
import { AgentHostError, type HostSendState, type Place } from '@juno/agent-contract'
import { JunoHost, type Account, type AccountId, type Attempt, type AttemptRecord, type Message, type PostOutcome, type Presence } from '@juno/agent-juno'
import type { EnginePhase } from '@juno/contract'
import { defaultNotificationSettings, inHours, notificationsPaused, type NotificationSettings, type Ts } from '@juno/domain'
import { readSettings } from '@juno/notifications'
import { liveQuery, StoreReader, transaction, type SqlError } from '@juno/store'
import { AiSpend } from '../aiSpend'
import { AiAudit } from '../aiAudit'
import { AiFallback } from '../aiFallback'
import { EngineConfig } from '../config'
import { MarkWorker } from '../markWorker'
import { resolve, undoResolve } from './resolve'
import { Outbox, type MirrorError } from '../outbox'
import { PostQueue } from '../postQueue'
import { makeAgentSearch } from './search'
import { SessionClient } from '../sessionClient'
import { SyncLink } from '../syncLink'
import { Workspace, type StoreServices } from '../workspace'
import { savedViews } from '../viewCommands'
import * as views from './views'
import * as attempts from './attempts'
import * as reads from './reads'
import { watchSnapshot, watchHours, watchChanges } from './schedule'

type SendState = typeof HostSendState.Type

/** The engine phase, which lives in the status feature; the composition layer provides it. */
export class PhaseSource extends Context.Service<PhaseSource, Stream.Stream<EnginePhase>>()('juno/engine/agent-host/PhaseSource') {}

const isSqlError = (error: unknown): error is SqlError => (error as { readonly _tag?: unknown } | undefined)?._tag === 'SqlError'

// `failed`: Slack answers, the sync just cannot finish, so reads still work.
const ONLINE = new Set<EnginePhase['_tag']>(['first-run', 'catching-up', 'live', 'failed', 'rate-limited'])

const hostError = (error: MirrorError): AgentHostError => {
  switch (error._tag) {
    case 'NotSignedIn':
      return new AgentHostError({ reason: 'signedOut', message: 'Juno is signed out of Slack.' })
    case 'Offline':
      return new AgentHostError({ reason: 'offline', message: 'Slack is not reachable.' })
    case 'RateLimited':
      return new AgentHostError({ reason: 'rateLimited', message: 'Slack asked Juno to slow down.' })
    case 'Rejected':
      return new AgentHostError({ reason: error.code === 'channel_not_found' ? 'notFound' : 'rejected', message: error.code })
  }
}

const readAccount = Effect.gen(function* () {
  const sql = yield* StoreReader
  const [team] = yield* sql<{ id: string; self_user_id: string | null }>`SELECT id, self_user_id FROM team LIMIT 1`
  return team === undefined || team.self_user_id === null ? undefined : { id: `${team.id}:${team.self_user_id}` as AccountId, userId: team.self_user_id }
})

type Hours = Pick<NotificationSettings, 'notificationHours' | 'presenceHours'>

/** Whether `millis` is outside notification hours, and not outside active hours, in local time. */
const hoursAt = (millis: number, hours: Hours) => {
  const date = new Date(millis)
  const at = { weekday: date.getDay() as 0, minutes: date.getHours() * 60 + date.getMinutes() }
  return {
    quietHours: notificationsPaused(at, hours.notificationHours),
    ownerActive: hours.presenceHours === undefined || inHours(at, hours.presenceHours),
  }
}

export const JunoHostLive: Layer.Layer<JunoHost, never, Workspace | Outbox | SessionClient | SyncLink | PhaseSource | EngineConfig | MarkWorker | AiSpend | AiAudit | AiFallback | PostQueue> = Layer.effect(
  JunoHost,
  Effect.gen(function* () {
    const config = yield* EngineConfig
    const worker = yield* MarkWorker
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const link = yield* SyncLink
    const search = makeAgentSearch(yield* SessionClient, link)
    const phases = yield* PhaseSource
    const spend = yield* AiSpend
    const audit = yield* AiAudit
    const fallback = yield* AiFallback
    const postQueue = yield* PostQueue

    /** Runs a store read on the open workspace. A store failure is a bug, so it dies. */
    const inStore = <A, E>(effect: Effect.Effect<A, E, StoreServices>): Effect.Effect<A, Exclude<E, SqlError> | AgentHostError> =>
      Effect.gen(function* () {
        const open = yield* workspace.current
        if (open === undefined) return yield* new AgentHostError({ reason: 'signedOut', message: 'Juno is signed out of Slack.' })
        return yield* effect.pipe(
          Effect.catch((error) => (isSqlError(error) ? Effect.die(error) : Effect.fail(error as Exclude<E, SqlError>))),
          Effect.provide(open.context),
        )
      })

    const account: Effect.Effect<Account, AgentHostError> = Effect.flatMap(inStore(readAccount), (found) =>
      found === undefined ? Effect.fail(new AgentHostError({ reason: 'signedOut', message: 'Juno is signed out of Slack.' })) : Effect.succeed(found),
    )

    /**
     * What became of a queued post, read in this order: its row, then its
     * message. Writing the message deletes the row in the same transaction,
     * so a row gone with no message means the owner deleted the draft.
     * Undefined while the row waits.
     */
    const postState = (attempt: Attempt) =>
      Effect.gen(function* () {
        const sql = yield* StoreReader
        const [row] = yield* sql<{ state: string; last_error: string | null }>`SELECT state, last_error FROM pending_messages WHERE client_msg_id = ${attempt.actionId}`
        if (row !== undefined) return row.state === 'failed' ? ({ _tag: 'refused', reason: row.last_error ?? 'failed' } satisfies PostOutcome) : undefined
        const [message] = yield* sql<{ ts: string; user_id: string | null }>`SELECT ts, user_id FROM messages
          WHERE client_msg_id = ${attempt.actionId} AND channel = ${attempt.channelId} AND deleted = 0 ORDER BY ts LIMIT 1`
        if (message === undefined) return { _tag: 'refused', reason: 'discarded' } satisfies PostOutcome
        const me = yield* readAccount
        // Someone else's message with this id is not the send: Juno cannot tell what became of it.
        return (message.user_id === me?.userId ? { _tag: 'posted', ts: message.ts } : { _tag: 'lost' }) satisfies PostOutcome
      })

    /** Waits for the queued post to settle. A workspace that closes or changes meanwhile leaves it unknown. */
    const posted = (attempt: Attempt): Effect.Effect<PostOutcome> =>
      Effect.gen(function* () {
        const open = yield* workspace.current
        if (open === undefined) return { _tag: 'lost' } satisfies PostOutcome
        const settled = liveQuery({ messages: [`channel:${attempt.channelId}`] }, postState(attempt)).pipe(
          Stream.filterMap((result) => (Result.isSuccess(result) && result.success !== undefined ? Result.succeed(result.success) : Result.failVoid)),
          Stream.provide(open.context),
          Stream.runHead,
        )
        const closed = workspace.changes.pipe(Stream.filter((next) => next !== open), Stream.runHead)
        const outcome = yield* Effect.raceFirst(settled, Effect.as(closed, Option.none<PostOutcome>()))
        return Option.getOrElse(outcome, (): PostOutcome => ({ _tag: 'lost' }))
      })

    const sent = (channelId: string, threadTs: string | undefined, clientMsgId: string) =>
      outbox
        .lookup((api) =>
          threadTs === undefined
            ? api.call('conversations.history', { channel: channelId, limit: 200 })
            : api.call('conversations.replies', { channel: channelId, ts: threadTs as Ts, limit: 200 }),
        )
        .pipe(
          Effect.map((page) =>
            page.messages
              .filter((m) => m.client_msg_id === clientMsgId)
              .map((m) =>
                reads.toMessage({
                  channel: channelId,
                  ts: m.ts,
                  thread_ts: m.thread_ts ?? null,
                  user_id: m.user ?? null,
                  text: m.text ?? '',
                  edited_ts: m.edited?.ts ?? null,
                  client_msg_id: m.client_msg_id ?? null,
                }),
              ),
          ),
          Effect.mapError(hostError),
        ) satisfies Effect.Effect<ReadonlyArray<Message>, AgentHostError>

    const online = phases.pipe(Stream.map((phase) => ONLINE.has(phase._tag)))
    const signedOutSettings = { aiEnabled: true, accountId: null, hours: defaultNotificationSettings as Hours }
    const settings = workspace.changes.pipe(
      Stream.switchMap((open) => {
        if (open === undefined) return Stream.make(signedOutSettings)
        const read = Effect.all({ prefs: readSettings, account: readAccount }).pipe(
          Effect.map(({ prefs, account: signedIn }) => ({ aiEnabled: prefs.aiAssist, accountId: signedIn?.id ?? null, hours: prefs.settings as Hours })),
        )
        return liveQuery(['prefs', 'team'], read).pipe(
          Stream.filterMap((result) => (Result.isSuccess(result) ? Result.succeed(result.success) : Result.failVoid)),
          Stream.provide(open.context),
        )
      }),
    )
    const clock = Stream.tick('1 minute').pipe(Stream.mapEffect(() => Clock.currentTimeMillis))
    // "This" is the topic last viewed (SPEC 7): the most recently shown one, kept after it closes.
    const lastViewed = yield* SubscriptionRef.make<string | undefined>(undefined)
    yield* link.shownChanges.pipe(
      Stream.runForEach((shown) => (shown[0] === undefined ? Effect.void : SubscriptionRef.set(lastViewed, shown[0]))),
      Effect.forkScoped,
    )
    const thisTopic = SubscriptionRef.changes(lastViewed).pipe(
      Stream.changes,
      Stream.mapEffect((topicId) =>
        topicId === undefined
          ? Effect.succeed(null)
          : inStore(reads.topicLink(topicId)).pipe(
              Effect.map((found): { topicId: string; place: Place } | null => (found === undefined ? null : { topicId, place: found.place })),
              Effect.catch(() => Effect.succeed(null)),
            ),
      ),
    )
    const presence = Stream.zipLatestAll(online, settings, clock, thisTopic).pipe(
      Stream.map(
        ([isOnline, { hours, ...current }, now, topic]): Presence =>
          ({ online: isOnline, ...current, ...hoursAt(now, hours), thisTopic: topic }) as Presence,
      ),
      Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    )

    // Bumped when the host records a send, so the outbox states take it in.
    const recorded = yield* SubscriptionRef.make(0)

    /** One send as its outbox row has it now (`HostSendState`). */
    const stateOf = (record: AttemptRecord, outcome: PostOutcome | undefined): SendState => {
      const ids = { attemptId: record.attemptId, actionId: record.actionId }
      if (outcome === undefined) return { ...ids, state: 'sending' }
      switch (outcome._tag) {
        case 'posted':
          return { ...ids, state: 'done', receipt: { channelId: record.channelId, ts: outcome.ts } }
        case 'refused':
          return { ...ids, state: 'failed', reason: outcome.reason }
        case 'lost':
          return { ...ids, state: 'unknown' }
      }
    }

    /**
     * Each recent send as its outbox row has it, again whenever a row or a
     * message in those channels changes: a refused send the owner retries
     * from the topic goes back to `sending`, then `done`. A send the outbox
     * posted after the host settled it otherwise is recorded `done` too.
     */
    const sendStates: Stream.Stream<ReadonlyArray<SendState>> = workspace.changes.pipe(
      Stream.switchMap((open) => {
        if (open === undefined) return Stream.succeed<ReadonlyArray<SendState>>([])
        return SubscriptionRef.changes(recorded).pipe(
          Stream.mapEffect(() => attempts.recent.pipe(Effect.provide(open.context), Effect.orDie)),
          Stream.switchMap((records) => {
            if (records.length === 0) return Stream.succeed<ReadonlyArray<SendState>>([])
            const channels = [...new Set(records.map((record) => `channel:${record.channelId}`))]
            const read = Effect.forEach(records, (record) => Effect.map(postState(record), (outcome) => ({ record, state: stateOf(record, outcome) })))
            return liveQuery({ messages: channels }, read).pipe(
              Stream.filterMap((result) => (Result.isSuccess(result) ? Result.succeed(result.success) : Result.failVoid)),
              Stream.tap((pairs) =>
                Effect.forEach(
                  pairs.filter(({ record, state }) => state.state === 'done' && record.state._tag !== 'done'),
                  ({ record, state }) => attempts.settle(record.authorizationId, { _tag: 'done', receipt: state.receipt! }),
                  { discard: true },
                ).pipe(Effect.provide(open.context), Effect.orDie),
              ),
              Stream.map((pairs) => pairs.map(({ state }) => state)),
              Stream.provide(open.context),
            )
          }),
        )
      }),
      Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    )

    return JunoHost.of({
      account,
      channels: (pattern, cursor, limit) => inStore(reads.channels(pattern, cursor, limit)),
      views: {
        list: inStore(savedViews),
        save: (view, id) => views.save(view, id).pipe(Effect.provideService(Workspace, workspace)),
        delete: (id) => views.remove(id).pipe(Effect.provideService(Workspace, workspace)),
        undo: (undo) => views.undo(undo).pipe(Effect.provideService(Workspace, workspace)),
      },
      search: (query, cursor, limit, options) => Effect.flatMap(account, (owner) => inStore(search(owner.id, query, cursor, limit, options))),
      history: (channelId, cursor, limit) => inStore(reads.history(channelId, cursor, limit)),
      replies: (channelId, threadTs, cursor, limit) => inStore(reads.replies(channelId, threadTs, cursor, limit)),
      topics: (cursor, limit) => inStore(reads.topics(cursor, limit)),
      topic: (topicId) => inStore(reads.topic(topicId)),
      person: (userId) => inStore(reads.person(userId)),
      people: (since, limit) => inStore(reads.people(since, limit)),
      members: (names) => inStore(reads.members(names)),
      resolve: (dispatch) => resolve(dispatch).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(EngineConfig, config), Effect.provideService(MarkWorker, worker)),
      undoResolve: (id) => undoResolve(id).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(EngineConfig, config), Effect.provideService(MarkWorker, worker)),
      presence,
      spend: spend.host,
      ai: { record: audit.record, fallback: fallback.set },
      schedule: {
        hours: inStore(watchHours),
        changes: watchChanges(workspace),
        check: (conversation, refresh) => Effect.gen(function* () {
          const before = yield* account
          const local = yield* inStore(watchSnapshot(conversation))
          if (!refresh) return local
          const messages = []
          let cursor: string | undefined
          const seen = new Set<string>()
          do {
            const page = yield* outbox.lookup((api) => conversation.threadTs === undefined
              ? api.call('conversations.history', { channel: conversation.channelId, oldest: conversation.ts, limit: 200, ...(cursor ? { cursor } : {}) })
              : api.call('conversations.replies', { channel: conversation.channelId, ts: conversation.threadTs as Ts, oldest: conversation.ts, limit: 200, ...(cursor ? { cursor } : {}) })).pipe(Effect.mapError(hostError))
            for (const message of page.messages) {
              if (message.user === undefined || message.ts <= conversation.ts) continue
              const threadTs = message.thread_ts === message.ts ? undefined : message.thread_ts
              if (conversation.threadTs === undefined && threadTs !== undefined) continue
              messages.push({ channelId: conversation.channelId, ts: message.ts, userId: message.user, ...(threadTs === undefined ? {} : { threadTs }) })
            }
            if ('is_limited' in page && page.is_limited === true) return yield* new AgentHostError({ reason: 'offline', message: 'The conversation refresh was limited.' })
            cursor = page.response_metadata?.next_cursor || undefined
            if (page.has_more && cursor === undefined || cursor !== undefined && seen.has(cursor)) return yield* new AgentHostError({ reason: 'offline', message: 'The conversation refresh was incomplete.' })
            if (cursor !== undefined) seen.add(cursor)
          } while (cursor !== undefined)
          const after = yield* account
          if (before.id !== after.id) return yield* new AgentHostError({ reason: 'stale', message: 'Another Slack account is signed in.' })
          return { ...local, messages }
        }),
      },
      attempts: {
        claim: (attempt, digest) =>
          inStore(transaction(attempts.claim(attempt, digest))).pipe(Effect.tap(() => Effect.andThen(postQueue.wake, SubscriptionRef.update(recorded, (n) => n + 1)))),
        cancel: (authorizationId, attemptId) => inStore(attempts.cancel(authorizationId, attemptId)),
        settle: (authorizationId, state) => inStore(attempts.settle(authorizationId, state)),
        byAttempt: (attemptId) => inStore(attempts.byAttempt(attemptId)),
      },
      posted,
      sendStates,
      sent,
    })
  }),
)
