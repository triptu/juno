/**
 * Sending (spec sections 8 and 9; architecture 5.7).
 *
 * Commands:
 * - `messages.send`: queues a message for a channel, a thread, or a person.
 *   A person with no DM yet gets one opened first (`conversations.open`),
 *   which needs Slack; otherwise the command only writes locally: the
 *   message shows at once as a pending row in `messages.list` and the
 *   outbox posts it. With `draftOf`, that topic's draft is cleared in the
 *   same transaction.
 * - `messages.retry`: Retry on a failed row. It is queued again.
 * - `messages.discard`: Delete draft on a failed row. It is removed.
 *
 * Drafts, kept per topic in `user.db` so they outlive the app:
 * - `drafts.get`: the topic's draft, `''` when it has none (a live value).
 * - `drafts.set`: replaces it; `''` deletes it.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotFound, NotSignedIn, Offline, RateLimited, Rejected } from '../errors'
import { liveValueRoute } from '../live'

/** Where a message goes: a conversation (and a thread in it), or a person with no DM yet. */
export const SendTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('channel'), channelId: Schema.String, threadTs: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('person'), userId: Schema.String }),
])
export type SendTarget = typeof SendTarget.Type

export const SendResult = Schema.Struct({
  /** The topic the message shows in: the thread, or the conversation's Main. */
  topicId: Schema.String,
})
export type SendResult = typeof SendResult.Type

export const SendError = Schema.Union([NotSignedIn, Offline, RateLimited, Rejected, NotFound])
export type SendError = typeof SendError.Type

/** `clientMsgId` is the renderer's: the post carries it, so the echo and pages are matched to the pending row (ADR 0011). */
export const messagesSend = Rpc.make('messages.send', {
  payload: { to: SendTarget, text: Schema.String, clientMsgId: Schema.String, draftOf: Schema.optionalKey(Schema.String) },
  success: SendResult,
  error: SendError,
})

/** Retry on a failed row. `NotFound` when the row is gone or not failed. */
export const messagesRetry = Rpc.make('messages.retry', { payload: { clientMsgId: Schema.String }, success: Schema.Void, error: NotFound })

/** Delete draft on a failed row. `NotFound` when the row is gone or not failed. */
export const messagesDiscard = Rpc.make('messages.discard', { payload: { clientMsgId: Schema.String }, success: Schema.Void, error: NotFound })

/** The draft of one topic, `''` when it has none. */
export const draftsGet = liveValueRoute('drafts.get', { payload: { topicId: Schema.String }, value: Schema.String })

/** Replaces a topic's draft; an empty or blank text deletes it. */
export const draftsSet = Rpc.make('drafts.set', { payload: { topicId: Schema.String, text: Schema.String }, success: Schema.Void, error: NotSignedIn })

export const SendRoutes = RpcGroup.make(messagesSend, messagesRetry, messagesDiscard, draftsGet, draftsSet)
