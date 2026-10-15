/**
 * Actions through the host (plan v3 §6.3; agent-contract `HostActionRpcs`):
 * a Slack send through Juno's outbox in single-attempt mode, and resolve.
 *
 * `ActionHost` is the host's action RPCs as promises, bound to the agent's
 * AgentHost client by `bindActionHost`; tests give a fake
 * (`@juno/agent-testing` `fakeActionHost`). The host records the attempt
 * before it calls Slack and answers a repeat of the same authorization from
 * that record, so it never sends twice. A host error means the host
 * refused before recording anything (writes off, wrong account, a payload
 * it does not take): a definite rejection. Any other failure, a lost port
 * included, may have reached Slack, so it is `unknown`.
 */
import { Effect } from 'effect'
import { AccountId, ActionId, AttemptId, digestJson, SLACK_SEND_TOOL, type ExecutableIdentity } from '@juno/agent-cards'
import {
  AgentHostError,
  HostChannelId,
  HostTopicId,
  type HostDispatch,
  type HostDispatchResult,
  type HostMessage,
  type Place,
  type TopicLink,
} from '@juno/agent-contract'
import { AgentHost } from '../host/client'
import type { Presence } from '../host/reads'
import type { Executor, ExecutorCall, ExecutorResult } from './executor'

type Dispatch = typeof HostDispatch.Type
type DispatchResult = typeof HostDispatchResult.Type

export interface ActionHost {
  /** The account Slack actions are for now: the presence's. Undefined while signed out. */
  readonly account: () => string | undefined
  readonly send: (dispatch: Dispatch) => Promise<DispatchResult>
  readonly resolve: (dispatch: Dispatch) => Promise<DispatchResult>
  readonly undoResolve?: (accountId: string, actionId: string) => Promise<void>
  /** A topic's link and place, for a card's target pill. */
  readonly topic: (topicId: string) => Promise<{ readonly topic: TopicLink; readonly place: Place }>
  /** `found` only on positive evidence. A miss is `unknown`, never proof that nothing was sent. */
  readonly reconcileSend: (input: {
    readonly accountId: string
    readonly channelId: string
    readonly actionId: string
    readonly attemptId: string
  }) => Promise<{ readonly _tag: 'found'; readonly message: typeof HostMessage.Type } | { readonly _tag: 'unknown' }>
}

/** The Slack connection's id in an executable identity: Slack has one, the signed-in account. */
export const SLACK_CONNECTION = 'slack'
/** The resolve tool. The host owns what resolving does. */
export const RESOLVE_TOOL = 'topics_resolve'

/**
 * The schema hash of the send tool's arguments (§6.2). The host takes
 * exactly `{ channelId, text, threadTs? }`; a change to that shape changes
 * this hash and voids every approval made under the old one.
 */
export const SLACK_SEND_SCHEMA = digestJson({ tool: SLACK_SEND_TOOL, args: { channelId: 'string', text: 'string', threadTs: 'string?' } })
export const RESOLVE_SCHEMA = digestJson({ tool: RESOLVE_TOOL, args: { topicIds: 'string[]' } })

/** Runs a host call; a failure rejects with the failure itself, so the executor sees an `AgentHostError`. */
const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(Effect.result(effect)).then((result) => (result._tag === 'Success' ? result.success : Promise.reject(result.failure)))

/** Follows the presence's account. Binds the host's action RPCs over the AgentHost client in the current scope. */
export const bindActionHost = (presence: () => Presence | undefined) =>
  Effect.gen(function* () {
    const client = yield* AgentHost
    return {
      account: () => presence()?.accountId ?? undefined,
      send: (dispatch) => run(client['host.outbox.send'](dispatch)),
      resolve: (dispatch) => run(client['host.topics.resolve'](dispatch)),
      undoResolve: (accountId, actionId) => run(client['host.topics.undoResolve']({ accountId: AccountId.make(accountId), actionId: ActionId.make(actionId) })),
      topic: (topicId) => run(client['host.topics.get']({ topicId: HostTopicId.make(topicId) })),
      reconcileSend: (input) =>
        run(
          client['host.outbox.reconcileSend']({
            accountId: AccountId.make(input.accountId),
            channelId: HostChannelId.make(input.channelId),
            actionId: ActionId.make(input.actionId),
            attemptId: AttemptId.make(input.attemptId),
          }),
        ),
    } satisfies ActionHost
  })

const dispatchOf = (call: ExecutorCall): Dispatch => ({
  actionId: call.actionId as Dispatch['actionId'],
  authorizationId: call.authorizationId as Dispatch['authorizationId'],
  attemptId: call.attemptId as Dispatch['attemptId'],
  digest: call.digest as Dispatch['digest'],
  payload: call.payload,
  mode: 'single-attempt',
})

/** What the host's answer means for the ledger. */
async function through(f: () => Promise<DispatchResult>): Promise<ExecutorResult> {
  try {
    const result = await f()
    switch (result._tag) {
      case 'done':
        return { _tag: 'done', receipt: result.receipt }
      case 'failed':
        return { _tag: 'failed', detail: result.reason }
      case 'unknown':
        return { _tag: 'unknown', detail: 'The host could not tell whether Slack took it.' }
    }
  } catch (error) {
    if (error instanceof AgentHostError) return { _tag: 'failed', detail: `${error.reason}: ${error.message}` }
    return { _tag: 'unknown', detail: 'The host did not answer.' }
  }
}

/** The click waits while no account is known; another signed-in account voids it. */
const accountCheck = (host: ActionHost, payload: ExecutableIdentity) => {
  const account = host.account()
  if (account === undefined) return 'wait' as const
  return account === payload.account_id ? ('valid' as const) : ('accountChanged' as const)
}

/** A Slack send and a resolve, through the host. */
export function hostExecutors(host: ActionHost): ReadonlyArray<Executor> {
  return [
    {
      tool: SLACK_SEND_TOOL,
      tier: 3,
      // No server-side dedupe is proven for Slack (§6.3).
      deduped: false,
      check: async (payload) => {
        if (payload.connection_id !== SLACK_CONNECTION) return 'connectionChanged'
        if (payload.schema_hash !== SLACK_SEND_SCHEMA) return 'schemaChanged'
        return accountCheck(host, payload)
      },
      run: (call) => through(() => host.send(dispatchOf(call))),
      reconcile: async (call) => {
        const channelId = call.payload.destination_ids[0]
        if (channelId === undefined) return { _tag: 'unknown' }
        try {
          const found = await host.reconcileSend({ accountId: call.payload.account_id, channelId, actionId: call.actionId, attemptId: call.attemptId })
          return found._tag === 'found' ? { _tag: 'found', receipt: { channelId: found.message.channelId, ts: found.message.ts } } : { _tag: 'unknown' }
        } catch {
          return { _tag: 'unknown' }
        }
      },
    },
    {
      tool: RESOLVE_TOOL,
      tier: 3,
      deduped: false,
      check: async (payload) => {
        if (payload.schema_hash !== RESOLVE_SCHEMA) return 'schemaChanged'
        return accountCheck(host, payload)
      },
      run: (call) => through(() => host.resolve(dispatchOf(call))),
    },
  ]
}
