/**
 * What the engine gives the AgentHost handlers: Juno's data and one Slack
 * write, without the protocol rules. The handlers (`handlers.ts`) add the
 * account check, the single-attempt ledger rules and the evidence rule; the
 * engine (`packages/engine/src/agent-host/`) implements this service over
 * the open workspace's store and the outbox.
 */
import { Context, type Effect, type Stream } from 'effect'
import type { WatchConversation, WatchSnapshot, WatchHours, AgentHostError, HostCursor, HostDispatch, HostMessage, HostMessagePage, HostPresence, HostUserId, Place, TopicLink } from '@juno/agent-contract'

export type Message = typeof HostMessage.Type
export type MessagePage = typeof HostMessagePage.Type
export type Presence = typeof HostPresence.Type
export type AccountId = NonNullable<Presence['accountId']>
export type Dispatch = typeof HostDispatch.Type
type AuthorizationId = Dispatch['authorizationId']
type AttemptId = Dispatch['attemptId']
type ActionId = Dispatch['actionId']

/** The signed-in Slack account: the agent's `accountId`, and the user its sends come from. */
export interface Account {
  readonly id: AccountId
  readonly userId: string
}

export interface Topic {
  readonly topic: TopicLink
  readonly place: Place
  readonly resolved: boolean
  readonly messages: MessagePage
}

/** One Slack send as the host records it before the call. `actionId` is the send's `client_msg_id`. */
export interface Attempt {
  readonly authorizationId: AuthorizationId
  readonly attemptId: AttemptId
  readonly actionId: ActionId
  readonly channelId: string
  readonly threadTs?: string
  readonly text: string
}

export type AttemptState =
  | { readonly _tag: 'submitted' }
  | { readonly _tag: 'done'; readonly receipt: { readonly channelId: string; readonly ts: string } }
  | { readonly _tag: 'failed'; readonly reason: string }
  | { readonly _tag: 'unknown' }
  | { readonly _tag: 'cancelled' }

export interface AttemptRecord extends Attempt {
  readonly state: AttemptState
}

/** What one `chat.postMessage` did. `lost`: no answer, so Slack may have posted it. */
export type PostOutcome =
  | { readonly _tag: 'posted'; readonly ts: string }
  | { readonly _tag: 'refused'; readonly reason: string }
  | { readonly _tag: 'lost' }

export class JunoHost extends Context.Service<
  JunoHost,
  {
    /** Fails with `signedOut` while no workspace is open. */
    readonly account: Effect.Effect<Account, AgentHostError>

    readonly search: (query: string, cursor: string | undefined, limit: number) => Effect.Effect<MessagePage, AgentHostError>
    readonly history: (channelId: string, cursor: string | undefined, limit: number) => Effect.Effect<MessagePage, AgentHostError>
    readonly replies: (channelId: string, threadTs: string, cursor: string | undefined, limit: number) => Effect.Effect<MessagePage, AgentHostError>
    readonly topics: (
      cursor: string | undefined,
      limit: number,
    ) => Effect.Effect<{ readonly topics: ReadonlyArray<TopicLink>; readonly next?: typeof HostCursor.Type }, AgentHostError>
    readonly topic: (topicId: string) => Effect.Effect<Topic, AgentHostError>
    readonly person: (userId: string) => Effect.Effect<{ readonly id: typeof HostUserId.Type; readonly name: string; readonly displayName: string }, AgentHostError>

    /** The current presence, then every change. */
    readonly presence: Stream.Stream<Presence>
    readonly schedule?: {
      readonly check: (conversation: typeof WatchConversation.Type, refresh: boolean) => Effect.Effect<typeof WatchSnapshot.Type, AgentHostError>
      readonly hours: Effect.Effect<typeof WatchHours.Type, AgentHostError>
      readonly changes: Stream.Stream<void>
    }

    readonly attempts: {
      /** Records `attempt` as `submitted` unless its authorization is recorded already; then returns that record and writes nothing. */
      readonly claim: (attempt: Attempt) => Effect.Effect<AttemptRecord | undefined, AgentHostError>
      /** Records the authorization as `cancelled`, the same way: a send that comes later is refused. */
      readonly cancel: (authorizationId: AuthorizationId, attemptId: AttemptId) => Effect.Effect<AttemptRecord | undefined, AgentHostError>
      readonly settle: (authorizationId: AuthorizationId, state: Exclude<AttemptState, { _tag: 'submitted' | 'cancelled' }>) => Effect.Effect<void, AgentHostError>
      readonly byAttempt: (attemptId: AttemptId) => Effect.Effect<AttemptRecord | undefined, AgentHostError>
    }
    /** One `chat.postMessage` with `client_msg_id = actionId`. Never retried. */
    readonly post: (attempt: Attempt) => Effect.Effect<PostOutcome>
    /** Messages Slack holds in the channel (or the thread) carrying `clientMsgId`, asked of Slack, not the cache. */
    readonly sent: (channelId: string, threadTs: string | undefined, clientMsgId: string) => Effect.Effect<ReadonlyArray<Message>, AgentHostError>
  }
>()('juno/agent-juno/JunoHost') {}
