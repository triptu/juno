/**
 * The host's action RPCs (agent-contract `HostActionRpcs`, plus the topic
 * lookup a card's place comes from), as the agent's `ActionHost` sees them,
 * with Slack behind them scripted. It keeps the host's rules
 * (`packages/agent-juno/README.md`, "Single-attempt sends"):
 *
 * - A send is recorded by its authorization before "Slack" sees it. The
 *   same authorization again is answered from the record and never sends.
 * - A refusal before anything is recorded is an `AgentHostError`.
 * - Reconcile finds a send only by positive evidence: a message in the
 *   channel with the action id as `client_msg_id`, from the owner, with the
 *   recorded text.
 *
 * `next(...outcomes)` scripts what the next sends do. With `file`, the
 * record and Slack's messages persist, so a test can kill the agent and
 * start it again against the same host.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Schema } from 'effect'
import { AgentHostError, HostMessage, Place, TopicLink, type HostDispatch, type HostDispatchResult } from '@juno/agent-contract'
import type { ActionHost } from '@juno/agent'

type Dispatch = typeof HostDispatch.Type
type Result = typeof HostDispatchResult.Type

/**
 * - `done`: Slack takes it.
 * - `failed`: Slack refuses it (for example `not_in_channel`).
 * - `unknown`: Slack takes it, and the answer is lost.
 * - `lostBefore`: the answer is lost and Slack never got it.
 * - `refused`: the host refuses before recording anything (writes off).
 * - `dropped`: the RPC fails with no answer after Slack took it.
 */
export type SendOutcome = 'done' | 'failed' | 'unknown' | 'lostBefore' | 'refused' | 'dropped'

export interface FakeActionHostOptions {
  /** The signed-in account. Default `A_TEST`. */
  readonly account?: string | null
  /** The owner's Slack user id: Slack's sender for the owner's sends. */
  readonly userId?: string
  /** Persist the record and Slack's messages here. */
  readonly file?: string
}

export const TEST_ACCOUNT = 'A_TEST'
export const TEST_CHANNEL = 'C0TEST0001'
const OWNER = 'U0OWNER001'

const place = (channelId: string): typeof Place.Type => Schema.decodeUnknownSync(Place)({ channelId, name: `#test-${channelId.slice(-4).toLowerCase()}`, kindLabel: 'Channel', tint: 'public' })

interface State {
  /** By authorization: what the host recorded and answered. */
  readonly record: Record<string, { readonly attemptId: string; readonly actionId: string; readonly result: Result }>
  readonly messages: Array<typeof HostMessage.Type>
  readonly resolved: Array<string>
}

export function fakeActionHost(options: FakeActionHostOptions = {}) {
  let account: string | null = options.account === undefined ? TEST_ACCOUNT : options.account
  const userId = options.userId ?? OWNER
  const load = (): State =>
    options.file !== undefined && existsSync(options.file) ? (JSON.parse(readFileSync(options.file, 'utf8')) as State) : { record: {}, messages: [], resolved: [] }
  const state = load()
  const save = () => {
    if (options.file !== undefined) writeFileSync(options.file, JSON.stringify(state))
  }
  const script: SendOutcome[] = []
  const sentListeners: Array<(dispatch: Dispatch) => void> = []
  const calls: Array<{ readonly rpc: 'send' | 'resolve'; readonly dispatch: Dispatch }> = []
  let ts = 0

  const post = (dispatch: Dispatch, outcome: SendOutcome): Result | 'dropped' => {
    const { channelId, text, threadTs } = dispatch.payload.args as { channelId: string; text: string; threadTs?: string }
    const posted = () =>
      state.messages.push(
        Schema.decodeUnknownSync(HostMessage)({
          channelId, ts: `1760500000.${String(++ts + state.messages.length).padStart(6, '0')}`, senderId: userId, text, clientMessageId: dispatch.actionId,
          ...(threadTs === undefined ? {} : { threadTs }),
        }),
      )
    switch (outcome) {
      case 'done':
        posted()
        return { _tag: 'done', attemptId: dispatch.attemptId, receipt: { channelId, ts: state.messages.at(-1)!.ts } }
      case 'failed':
        return { _tag: 'failed', attemptId: dispatch.attemptId, reason: 'not_in_channel' }
      case 'unknown':
        posted()
        return { _tag: 'unknown', attemptId: dispatch.attemptId }
      case 'lostBefore':
        return { _tag: 'unknown', attemptId: dispatch.attemptId }
      case 'dropped':
        posted()
        return 'dropped'
      case 'refused':
        throw new Error('refused is answered before the record')
    }
  }

  const dispatchWith = async (rpc: 'send' | 'resolve', dispatch: Dispatch): Promise<Result> => {
    calls.push({ rpc, dispatch })
    const prior = state.record[dispatch.authorizationId]
    if (prior !== undefined) return prior.result
    const outcome = script.shift() ?? 'done'
    if (outcome === 'refused') throw new AgentHostError({ reason: 'unsupported', message: 'Juno does not send to Slack yet.' })
    if (account === null || dispatch.payload.account_id !== account) throw new AgentHostError({ reason: 'stale', message: 'Another Slack account is signed in.' })
    if (rpc === 'resolve') {
      const result: Result =
        outcome === 'failed' ? { _tag: 'failed', attemptId: dispatch.attemptId, reason: 'not_found' } : { _tag: 'done', attemptId: dispatch.attemptId, receipt: { resolved: true } }
      if (result._tag === 'done') state.resolved.push(...((dispatch.payload.args as { topicIds: string[] }).topicIds ?? []))
      state.record[dispatch.authorizationId] = { attemptId: dispatch.attemptId, actionId: dispatch.actionId, result }
      save()
      return result
    }
    const result = post(dispatch, outcome)
    for (const listener of sentListeners) listener(dispatch)
    const recorded: Result = result === 'dropped' ? { _tag: 'unknown', attemptId: dispatch.attemptId } : result
    state.record[dispatch.authorizationId] = { attemptId: dispatch.attemptId, actionId: dispatch.actionId, result: recorded }
    save()
    if (result === 'dropped') throw new Error('the host port closed')
    return result
  }

  const host: ActionHost = {
    account: () => account ?? undefined,
    send: (dispatch) => dispatchWith('send', dispatch),
    resolve: (dispatch) => dispatchWith('resolve', dispatch),
    topic: async (topicId) => {
      const main = /^m:([^:]+)$/.exec(topicId)
      const thread = /^t:([^:]+):([^:]+)$/.exec(topicId)
      const channelId = main?.[1] ?? thread?.[1]
      if (channelId === undefined) throw new AgentHostError({ reason: 'notFound', message: 'No such topic.' })
      const where = place(channelId)
      const topic = Schema.decodeUnknownSync(TopicLink)({ topicId, title: thread ? 'Test thread' : where.name, where: where.name, tint: 'public' })
      return { topic, place: where }
    },
    reconcileSend: async ({ channelId, actionId, attemptId }) => {
      const recorded = Object.values(state.record).find((r) => r.attemptId === attemptId && r.actionId === actionId)
      const found = state.messages.find((m) => m.channelId === channelId && m.clientMessageId === actionId && m.senderId === userId)
      // A send the host has no record of is never claimed, even if a message with its id exists.
      return recorded !== undefined && found !== undefined ? { _tag: 'found', message: found } : { _tag: 'unknown' }
    },
  }

  return {
    host,
    /** What the next sends do, in order. Unscripted sends succeed. */
    next: (...outcomes: ReadonlyArray<SendOutcome>) => {
      script.push(...outcomes)
    },
    /** Every send and resolve RPC the agent made, repeats included. */
    calls,
    /** The messages Slack holds, oldest first. */
    messages: () => state.messages,
    /** Topics resolved. */
    resolved: () => state.resolved,
    /** Someone else's message with this `client_msg_id` (`forgedSendReceipt`). */
    plant: (message: typeof HostMessage.Type) => {
      state.messages.push(message)
      save()
    },
    /** Called after each send Slack saw, before the agent gets the answer. */
    onSend: (listener: (dispatch: Dispatch) => void) => {
      sentListeners.push(listener)
    },
    signOut: () => {
      account = null
    },
    signIn: (id = TEST_ACCOUNT) => {
      account = id
    },
  }
}

export type FakeActionHost = ReturnType<typeof fakeActionHost>
