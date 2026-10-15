/**
 * The AgentHost handlers Juno's engine serves to the agent (ADR 0012): the
 * whole group, `AgentHostRpcs`, over `JunoHost`.
 *
 * - Every request names the account it was made for. A request for another
 *   account than the signed-in one fails with `stale`; none open, `signedOut`.
 * - Slack and topic reads come from Juno's local store.
 * - Sends are single-attempt (`dispatch.ts`). They are off unless the
 *   options turn them on: external writes are disabled in M2 (plan v3 §17),
 *   so a send fails with `unsupported` before anything is recorded.
 * - Resolve and OS notification delivery fail with `unsupported`: Juno has
 *   no resolve command or notifier yet (M3 and M10 add them).
 *
 * `host.hello` answers the one protocol the host serves; the agent refuses
 * a host whose protocol differs from its own.
 */
import { Effect } from 'effect'
import { AGENT_HOST_PROTOCOL, AgentHostError, AgentHostRpcs } from '@juno/agent-contract'
import { makeDispatcher, parseSend } from './dispatch'
import { JunoHost, type Account, type AccountId } from './host'

export interface HandlerOptions {
  /** Whether sends reach Slack. `disabled` in the app until M3. */
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
        'host.topics.resolve': () => unsupported('Juno cannot resolve a topic for the agent yet.'),

        'host.presence': () => host.presence,
        'host.notification.deliver': () => unsupported('Juno cannot show notifications for the agent yet.'),
      })
    }),
  )
