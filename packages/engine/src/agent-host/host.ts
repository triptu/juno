/**
 * The engine's `JunoHost` (`@juno/agent-juno`): what the AgentHost handlers
 * read and write, over the open workspace and the outbox (ADR 0012).
 *
 * - Reads use the open workspace's store (`reads.ts`); with none open they
 *   fail with `signedOut`.
 * - The send is `Outbox.sendOnce`, the single-attempt mode: one
 *   `chat.postMessage` with `client_msg_id` set to the action id, no retry.
 *   It is recorded as sent first (`recordSend`), so a second copy the
 *   network makes is deleted when Juno stores it (ADR 0014).
 * - `sent` asks Slack, not the store, for the reconcile lookup.
 * - Spend asks come from `AiSpend`: the engine's model calls reserve and
 *   settle in the agent's daily cap.
 * - The hours-start summaries come from the notification host, which
 *   holds them until the agent has appended them.
 * - Presence follows the engine phase, the AI assist pref, the clock against
 *   the notification and active hours the notifications engine reads
 *   (`@juno/notifications` settings), and the topic last shown.
 */
import { Clock, Context, Effect, Layer, Result, Stream, SubscriptionRef } from 'effect'
import { AgentHostError, type Place } from '@juno/agent-contract'
import { JunoHost, type Account, type AccountId, type Attempt, type Message, type PostOutcome, type Presence } from '@juno/agent-juno'
import type { EnginePhase } from '@juno/contract'
import { defaultNotificationSettings, inHours, type NotificationSettings, type Ts } from '@juno/domain'
import { readSettings } from '@juno/notifications'
import { liveQuery, StoreReader, transaction, type SqlError } from '@juno/store'
import { recordSend, storedMe } from '@juno/sync'
import { AiSpend } from '../aiSpend'
import { EngineConfig } from '../config'
import { MarkWorker } from '../markWorker'
import { NotificationHost } from '../notificationRuntime'
import { resolve, undoResolve } from './resolve'
import { Outbox, type MirrorError } from '../outbox'
import { SyncLink } from '../syncLink'
import { Workspace, type StoreServices } from '../workspace'
import { savedViews } from '../viewCommands'
import * as views from './views'
import * as attempts from './attempts'
import * as reads from './reads'
import { watchSnapshot, watchHours, watchChanges } from './schedule'

/** The engine phase, which lives in the status feature; the composition layer provides it. */
export class PhaseSource extends Context.Service<PhaseSource, Stream.Stream<EnginePhase>>()('juno/engine/agent-host/PhaseSource') {}

const isSqlError = (error: unknown): error is SqlError => (error as { readonly _tag?: unknown } | undefined)?._tag === 'SqlError'

const ONLINE = new Set<EnginePhase['_tag']>(['first-run', 'catching-up', 'live', 'rate-limited'])

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

const postOutcome = (error: MirrorError): PostOutcome => {
  switch (error._tag) {
    case 'Offline':
      return { _tag: 'lost' }
    case 'NotSignedIn':
      return { _tag: 'refused', reason: 'signedOut' }
    case 'RateLimited':
      return { _tag: 'refused', reason: 'rateLimited' }
    case 'Rejected':
      return { _tag: 'refused', reason: error.code }
  }
}

const readAccount = Effect.gen(function* () {
  const sql = yield* StoreReader
  const [team] = yield* sql<{ id: string; self_user_id: string | null }>`SELECT id, self_user_id FROM team LIMIT 1`
  return team === undefined || team.self_user_id === null ? undefined : { id: `${team.id}:${team.self_user_id}` as AccountId, userId: team.self_user_id }
})

type Hours = Pick<NotificationSettings, 'notificationHours' | 'presenceHours'>

/** Whether `millis` is outside notification hours, and inside active hours, in local time. */
const hoursAt = (millis: number, hours: Hours) => {
  const date = new Date(millis)
  const at = { weekday: date.getDay() as 0, minutes: date.getHours() * 60 + date.getMinutes() }
  return {
    quietHours: !inHours(at, hours.notificationHours),
    ownerActive: inHours(at, hours.presenceHours),
  }
}

export const JunoHostLive: Layer.Layer<JunoHost, never, Workspace | Outbox | SyncLink | PhaseSource | EngineConfig | MarkWorker | AiSpend> = Layer.effect(
  JunoHost,
  Effect.gen(function* () {
    const config = yield* EngineConfig
    const worker = yield* MarkWorker
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const link = yield* SyncLink
    const phases = yield* PhaseSource
    const notificationHost = yield* NotificationHost
    const spend = yield* AiSpend

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

    const post = (attempt: Attempt): Effect.Effect<PostOutcome> =>
      // Recorded before it leaves, so a copy the network makes is deleted (ADR 0014).
      inStore(Effect.flatMap(storedMe, (me) => transaction(recordSend(attempt.actionId, attempt.channelId, me?.userId ?? '')))).pipe(
        Effect.flatMap(() => send(attempt)),
        Effect.catchTag('AgentHostError', () => Effect.succeed<PostOutcome>({ _tag: 'refused', reason: 'signedOut' })),
      )

    const send = (attempt: Attempt): Effect.Effect<PostOutcome> =>
      outbox
        .sendOnce((api) =>
          api.call('chat.postMessage', {
            channel: attempt.channelId,
            text: attempt.text,
            client_msg_id: attempt.actionId,
            ...(attempt.threadTs === undefined ? {} : { thread_ts: attempt.threadTs as Ts }),
          }),
        )
        .pipe(
          Effect.map((answer): PostOutcome => ({ _tag: 'posted', ts: answer.ts })),
          Effect.catch((error) => Effect.succeed(postOutcome(error))),
          // A bug after the request left may still have posted: unknown, never failed.
          Effect.catchDefect(() => Effect.succeed<PostOutcome>({ _tag: 'lost' })),
        )

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

    return JunoHost.of({
      account,
      channels: (pattern, cursor, limit) => inStore(reads.channels(pattern, cursor, limit)),
      views: {
        list: inStore(savedViews),
        save: (view, id) => views.save(view, id).pipe(Effect.provideService(Workspace, workspace)),
        delete: (id) => views.remove(id).pipe(Effect.provideService(Workspace, workspace)),
        undo: (undo) => views.undo(undo).pipe(Effect.provideService(Workspace, workspace)),
      },
      search: (query, cursor, limit) => inStore(reads.search(query, cursor, limit)),
      history: (channelId, cursor, limit) => inStore(reads.history(channelId, cursor, limit)),
      replies: (channelId, threadTs, cursor, limit) => inStore(reads.replies(channelId, threadTs, cursor, limit)),
      topics: (cursor, limit) => inStore(reads.topics(cursor, limit)),
      topic: (topicId) => inStore(reads.topic(topicId)),
      person: (userId) => inStore(reads.person(userId)),
      resolve: (dispatch) => resolve(dispatch).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(EngineConfig, config), Effect.provideService(MarkWorker, worker)),
      undoResolve: (id) => undoResolve(id).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(EngineConfig, config), Effect.provideService(MarkWorker, worker)),
      presence,
      ...(notificationHost.summaries === undefined ? {} : { summaries: notificationHost.summaries }),
      spend: spend.host,
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
        claim: (attempt) => inStore(attempts.claim(attempt)),
        cancel: (authorizationId, attemptId) => inStore(attempts.cancel(authorizationId, attemptId)),
        settle: (authorizationId, state) => inStore(attempts.settle(authorizationId, state)),
        byAttempt: (attemptId) => inStore(attempts.byAttempt(attemptId)),
      },
      post,
      sent,
    })
  }),
)
