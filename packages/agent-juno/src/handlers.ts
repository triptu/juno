/**
 * The AgentHost handlers Juno's engine serves to the agent (ADR 0012): the
 * whole group, `AgentHostRpcs`, over `JunoHost`.
 *
 * - Every request names the account it was made for. A request for another
 *   account than the signed-in one fails with `stale`; none open, `signedOut`.
 * - Slack and topic reads come from Juno's local store.
 * - Sends are single-attempt (`dispatch.ts`). They are off unless the
 *   options turn them on. The desktop enables them for approved cards;
 *   a disabled host refuses before recording an attempt.
 * - Resolve uses the local topic command and retains its Undo.
 * - OS notification delivery remains unsupported.
 * - Spend asks go the other way: the engine's model calls offer
 *   reservations and settlements, and the agent answers from its ledger.
 *
 * `host.hello` answers the one protocol the host serves; the agent refuses
 * a host whose protocol differs from its own.
 */
import { Effect, Stream } from 'effect'
import { AGENT_HOST_PROTOCOL, AgentHostError, AgentHostRpcs } from '@juno/agent-contract'
import { makeDispatcher, parseSend } from './dispatch'
import { JunoHost, type Account, type AccountId } from './host'

export interface HandlerOptions {
  /** Whether approved sends reach Slack. */
  readonly writes: 'enabled' | 'disabled'
}

const unsupported = (message: string) => Effect.fail(new AgentHostError({ reason: 'unsupported', message }))

export const agentHostHandlers = (options: HandlerOptions) =>
  AgentHostRpcs.toLayer(
    Effect.gen(function* () {
      const host = yield* JunoHost
      const dispatcher = yield* makeDispatcher

      /** The signed-in account, if it is the one the agent named. */
      const accountFor = (accountId: AccountId): Effect.Effect<Account, AgentHostError> =>
        Effect.flatMap(host.account, (account) =>
          account.id === accountId
            ? Effect.succeed(account)
            : Effect.fail(new AgentHostError({ reason: 'stale', message: 'Another Slack account is signed in.' })),
        )
      const asAccount = <A>(accountId: AccountId, read: Effect.Effect<A, AgentHostError>) => Effect.andThen(accountFor(accountId), read)

      return AgentHostRpcs.of({
        'host.hello': () => Effect.succeed({ host: 'juno', protocol: AGENT_HOST_PROTOCOL }),

        'host.slack.channels': ({ accountId, pattern, cursor, limit }) => asAccount(accountId, host.channels?.(pattern, cursor, limit) ?? unsupported('Channel lookup is unavailable.')),
        'host.views.list': ({ accountId }) => asAccount(accountId, host.views?.list ?? unsupported('Views are unavailable.')),
        'host.views.create': ({ accountId, view }) => asAccount(accountId, host.views?.save(view) ?? unsupported('Views are unavailable.')),
        'host.views.update': ({ accountId, id, view }) => asAccount(accountId, host.views?.save(view, id) ?? unsupported('Views are unavailable.')),
        'host.views.delete': ({ accountId, id }) => asAccount(accountId, host.views?.delete(id) ?? unsupported('Views are unavailable.')),
        'host.views.undo': ({ accountId, undo }) => asAccount(accountId, host.views?.undo(undo) ?? unsupported('Views are unavailable.')),
        'host.slack.search': ({ accountId, query, cursor, limit }) => asAccount(accountId, host.search(query, cursor, limit)),
        'host.slack.history': ({ accountId, channelId, cursor, limit }) => asAccount(accountId, host.history(channelId, cursor, limit)),
        'host.slack.replies': ({ accountId, channelId, threadTs, cursor, limit }) => asAccount(accountId, host.replies(channelId, threadTs, cursor, limit)),
        'host.slack.person': ({ accountId, userId }) => asAccount(accountId, host.person(userId)),
        'host.topics.list': ({ cursor, limit }) => host.topics(cursor, limit),
        'host.topics.get': ({ topicId }) =>
          Effect.gen(function* () {
            const account = yield* host.account
            const topic = yield* host.topic(topicId)
            return { ...topic, accountId: account.id }
          }),

        'host.outbox.send': (dispatch) =>
          Effect.gen(function* () {
            if (options.writes === 'disabled') return yield* unsupported('Juno does not send to Slack yet.')
            const attempt = parseSend(dispatch)
            if (attempt instanceof AgentHostError) return yield* attempt
            yield* accountFor(dispatch.payload.account_id)
            return yield* dispatcher.send(attempt)
          }),
        'host.outbox.cancel': ({ authorizationId, attemptId }) => dispatcher.cancel(authorizationId, attemptId),
        'host.outbox.reconcileSend': ({ accountId, channelId, actionId, attemptId }) =>
          Effect.flatMap(accountFor(accountId), (account) => dispatcher.reconcile(attemptId, channelId, actionId, account.userId)),
        'host.topics.resolve': (dispatch) => asAccount(dispatch.payload.account_id, host.resolve?.(dispatch) ?? unsupported('Resolve is unavailable.')),
        'host.topics.undoResolve': ({ accountId, actionId }) => asAccount(accountId, host.undoResolve?.(actionId) ?? unsupported('Resolve Undo is unavailable.')),

        'host.schedule.check': ({ accountId, conversation, refresh }) => asAccount(accountId, host.schedule?.check(conversation, refresh) ?? unsupported('Reply watches are unavailable.')).pipe(Effect.tap(() => accountFor(accountId))),
        'host.schedule.hours': ({ accountId }) => asAccount(accountId, host.schedule?.hours ?? unsupported('Notification hours are unavailable.')),
        'host.schedule.changes': () => host.schedule?.changes ?? Stream.empty,
        'host.presence': () => host.presence,
        'host.notification.deliver': () => unsupported('Juno cannot show notifications for the agent yet.'),
        'host.spend.asks': () => host.spend?.asks ?? Stream.never,
        'host.spend.answer': (answer) => host.spend?.answer(answer) ?? Effect.void,
        'host.spend.room': () => host.spend?.room ?? Effect.void,
        'host.ai.record': ({ call }) => host.ai?.record(call) ?? Effect.void,
      })
    }),
  )
