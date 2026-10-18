/**
 * What the engine gives the AgentHost handlers: Juno's data and one Slack
 * write, without the protocol rules. The handlers (`handlers.ts`) add the
 * account check, the digest check, the ledger rules and the evidence rule; the
 * engine (`packages/engine/src/agent-host/`) implements this service over
 * the open workspace's store and the outbox.
 */
import { Context, type Effect, type Stream } from 'effect'
import type { HostAiCall, HostInteraction, HostSpendAsk, HostView, HostViewDraft, HostViewChange, HostViewUndo, HostChannel, WatchConversation, WatchSnapshot, WatchHours, AgentHostError, HostCursor, HostDispatch, HostMessage, HostMessagePage, HostPresence, HostSendState, HostUserId, Place, TopicLink } from '@juno/agent-contract'

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

/** What became of a queued post. `refused`: Slack's code, or `discarded`. `lost`: Juno cannot tell. */
export type PostOutcome =
  | { readonly _tag: 'posted'; readonly ts: string }
  | { readonly _tag: 'refused'; readonly reason: string }
  | { readonly _tag: 'lost' }

export class JunoHost extends Context.Service<
  JunoHost,
  {
    /** Fails with `signedOut` while no workspace is open. */
    readonly account: Effect.Effect<Account, AgentHostError>

    readonly channels?: (pattern: string, cursor: string | undefined, limit: number) => Effect.Effect<{ readonly channels: ReadonlyArray<typeof HostChannel.Type>; readonly next?: typeof HostCursor.Type }, AgentHostError>
    readonly views?: {
      readonly list: Effect.Effect<ReadonlyArray<typeof HostView.Type>, AgentHostError>
      readonly save: (view: typeof HostViewDraft.Type, id?: string) => Effect.Effect<typeof HostViewChange.Type, AgentHostError>
      readonly delete: (id: string) => Effect.Effect<typeof HostViewChange.Type, AgentHostError>
      readonly undo: (undo: typeof HostViewUndo.Type) => Effect.Effect<void, AgentHostError>
    }
    readonly search: (query: string, cursor: string | undefined, limit: number) => Effect.Effect<MessagePage, AgentHostError>
    readonly history: (channelId: string, cursor: string | undefined, limit: number) => Effect.Effect<MessagePage, AgentHostError>
    readonly replies: (channelId: string, threadTs: string, cursor: string | undefined, limit: number) => Effect.Effect<MessagePage, AgentHostError>
    readonly topics: (
      cursor: string | undefined,
      limit: number,
    ) => Effect.Effect<{ readonly topics: ReadonlyArray<TopicLink>; readonly next?: typeof HostCursor.Type }, AgentHostError>
    readonly topic: (topicId: string) => Effect.Effect<Topic, AgentHostError>
    readonly resolve?: (dispatch: Dispatch) => Effect.Effect<typeof import('@juno/agent-contract').HostDispatchResult.Type, AgentHostError>
    readonly undoResolve?: (actionId: string) => Effect.Effect<void, AgentHostError>
    readonly person: (userId: string) => Effect.Effect<{ readonly id: typeof HostUserId.Type; readonly name: string; readonly displayName: string }, AgentHostError>
    /** Who the owner exchanged messages with in DMs and threads since `since` (ms), most first: counts and names only. */
    readonly people?: (since: number, limit: number) => Effect.Effect<{ readonly people: ReadonlyArray<typeof HostInteraction.Type> }, AgentHostError>
    /** Workspace members for each name asked. */
    readonly members?: (names: ReadonlyArray<string>) => Effect.Effect<{ readonly members: ReadonlyArray<{ readonly name: string; readonly ids: ReadonlyArray<{ readonly id: typeof HostUserId.Type; readonly name: string }> }> }, AgentHostError>

    /** The current presence, then every change. */
    readonly presence: Stream.Stream<Presence>
    /** The engine's model calls asking the agent's spend ledger (plan v3 §5.4): open asks now and on every change, and the answers. */
    readonly spend?: {
      readonly asks: Stream.Stream<ReadonlyArray<HostSpendAsk>>
      readonly answer: (answer: { readonly id: string; readonly ask: 'reserve' | 'settle'; readonly result: 'reserved' | 'blocked' | 'settled' }) => Effect.Effect<void>
      /** The ledger may have room again; the jobs that stopped at the cap start a new pass. */
      readonly room: Effect.Effect<void>
    }
    /** Records one of the agent's model calls in the AI activity log. Never fails; a record with no workspace open is dropped. */
    readonly ai?: {
      readonly record: (call: HostAiCall) => Effect.Effect<void>
      /** The fallback model's slug from Settings › Juno, '' for none. */
      readonly fallback?: (model: string) => Effect.Effect<void>
    }
    readonly schedule?: {
      readonly check: (conversation: typeof WatchConversation.Type, refresh: boolean) => Effect.Effect<typeof WatchSnapshot.Type, AgentHostError>
      readonly hours: Effect.Effect<typeof WatchHours.Type, AgentHostError>
      readonly changes: Stream.Stream<void>
    }

    readonly attempts: {
      /**
       * Returns the record of the attempt's authorization if there is one, and
       * writes nothing. Otherwise, in one transaction: takes the owner's click
       * on the action with `digest`, records `attempt` as `submitted` and
       * queues its post as the composer does. Fails with `rejected` when no
       * unused click matches the action and digest.
       */
      readonly claim: (attempt: Attempt, digest: string) => Effect.Effect<AttemptRecord | undefined, AgentHostError>
      /** Records the authorization as `cancelled`, the same way: a send that comes later is refused. */
      readonly cancel: (authorizationId: AuthorizationId, attemptId: AttemptId) => Effect.Effect<AttemptRecord | undefined, AgentHostError>
      readonly settle: (authorizationId: AuthorizationId, state: Exclude<AttemptState, { _tag: 'submitted' | 'cancelled' }>) => Effect.Effect<void, AgentHostError>
      readonly byAttempt: (attemptId: AttemptId) => Effect.Effect<AttemptRecord | undefined, AgentHostError>
    }
    /** Waits for the attempt's queued post to settle: Slack has it, refused it, or the owner deleted the draft. */
    readonly posted: (attempt: Attempt) => Effect.Effect<PostOutcome>
    /** Each recent send as its outbox row has it now, then on every change (`host.outbox.states`). */
    readonly sendStates?: Stream.Stream<ReadonlyArray<typeof HostSendState.Type>>
    /** Messages Slack holds in the channel (or the thread) carrying `clientMsgId`, asked of Slack, not the cache. */
    readonly sent: (channelId: string, threadTs: string | undefined, clientMsgId: string) => Effect.Effect<ReadonlyArray<Message>, AgentHostError>
  }
>()('juno/agent-juno/JunoHost') {}
