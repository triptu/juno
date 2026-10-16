/**
 * Sending (spec sections 8 and 9; architecture 5.7).
 *
 * Commands:
 * - `messages.send`: queues a message, with any staged files, for a
 *   channel, a thread, or a person.
 *   A person with no DM yet gets one opened first (`conversations.open`),
 *   which needs Slack; otherwise the command only writes locally: the
 *   message shows at once as a pending row in `messages.list` and the
 *   outbox posts it. With `draftOf`, that topic's draft is cleared in the
 *   same transaction.
 * - `messages.retry`: Retry on a failed row. It is queued again.
 * - `messages.discard`: Delete draft on a failed row. It is removed.
 * - `messages.edit`, `messages.delete`: the user's own message, from the
 *   hover toolbar's More menu, the message menu or the keyboard. Both write
 *   locally and answer at once: the list shows the change straight away and
 *   the outbox sends it. A message Slack may not have yet waits for it
 *   (`depends_on`). Neither has an undo (ADR 0010).
 * - `messages.react`: adds or removes the user's reaction, the same way.
 * - `messages.precheck`: while typing pauses, asks grammar and (in Main) route models
 *   whether the draft reads like a reply to one of the channel's latest
 *   topics (`routeCheck`) and stores the answer. Answers once it is stored.
 * - `messages.check`: the checks on send (spec section 8), run on Enter
 *   before `messages.send`. It never waits for a model: the wrong-place
 *   finding is the precheck's stored answer for this exact draft, if there
 *   is one, and the clarity check's minimal fixes run on every draft. Empty
 *   when nothing was found: the message then just sends.
 *
 * A message Slack refuses to change (too old to edit, say) goes back to
 * what Slack has.
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

/**
 * `clientMsgId` is the renderer's: the post carries it, so the echo and pages are matched to the pending row (ADR 0011).
 * `files` are staged files (`files.stage`) that go with the text, in order; the text may then be empty.
 * `Rejected` `no_text` for nothing to send, `file_not_found` for a file that is not staged.
 */
export const messagesSend = Rpc.make('messages.send', {
  payload: {
    to: SendTarget,
    text: Schema.String,
    clientMsgId: Schema.String,
    draftOf: Schema.optionalKey(Schema.String),
    files: Schema.optionalKey(Schema.Array(Schema.String)),
  },
  success: SendResult,
  error: SendError,
})

/** Retry on a failed row. `NotFound` when the row is gone or not failed. */
export const messagesRetry = Rpc.make('messages.retry', { payload: { clientMsgId: Schema.String }, success: Schema.Void, error: NotFound })

/** Delete draft on a failed row. `NotFound` when the row is gone or not failed. */
export const messagesDiscard = Rpc.make('messages.discard', { payload: { clientMsgId: Schema.String }, success: Schema.Void, error: NotFound })

/**
 * A message as the list shows it: its channel and `ts`, which is
 * `pending:<clientMsgId>` for a post Slack does not have yet, and its
 * `clientMsgId` when it has one, so a pending post is found after it
 * becomes the stored message.
 */
export const MessageRef = Schema.Struct({ channelId: Schema.String, ts: Schema.String, clientMsgId: Schema.optionalKey(Schema.String) })
export type MessageRef = typeof MessageRef.Type

export const MessageActionError = Schema.Union([NotFound, NotSignedIn, Rejected])
export type MessageActionError = typeof MessageActionError.Type

/** Edit an own message. `NotFound` when it is gone or not the user's; `Rejected` `no_text` for an empty text. */
export const messagesEdit = Rpc.make('messages.edit', { payload: { message: MessageRef, text: Schema.String }, success: Schema.Void, error: MessageActionError })

/** Delete an own message. `NotFound` when it is gone or not the user's. */
export const messagesDelete = Rpc.make('messages.delete', { payload: { message: MessageRef }, success: Schema.Void, error: MessageActionError })

/** Add (`on`) or remove the user's reaction `name` (Slack's name, such as `+1`). `NotFound` when the message is gone. */
export const messagesReact = Rpc.make('messages.react', {
  payload: { message: MessageRef, name: Schema.String, on: Schema.Boolean },
  success: Schema.Void,
  error: MessageActionError,
})

/** Wrong place: the draft reads like a reply to this topic of the channel. */
export const RouteFinding = Schema.Struct({
  topicId: Schema.String,
  /** The thread's root, where Post in thread sends. */
  threadTs: Schema.String,
  title: Schema.String,
  /** 0 to 1, shown as a percentage. */
  confidence: Schema.Number,
})
export type RouteFinding = typeof RouteFinding.Type

/** Clarity: minimal fixes, a note about a long sentence, or both. */
export const ClarityFinding = Schema.Struct({
  /** "recieve → receive", "the the → the", "add ?". Empty when only the note applies. */
  fixes: Schema.Array(Schema.String),
  /** The draft with every fix applied. */
  fixed: Schema.String,
  /** "One sentence runs over 40 words." */
  note: Schema.optionalKey(Schema.String),
  confidence: Schema.Number,
})
export type ClarityFinding = typeof ClarityFinding.Type

export const SendCheck = Schema.Struct({ route: Schema.optionalKey(RouteFinding), clarity: Schema.optionalKey(ClarityFinding) })
export type SendCheck = typeof SendCheck.Type

/** The checks on send for a draft going to the channel (`threadTs` absent: its Main). */
export const messagesCheck = Rpc.make('messages.check', {
  payload: { channelId: Schema.String, threadTs: Schema.optionalKey(Schema.String), text: Schema.String },
  success: SendCheck,
})

/** Grammar and wrong-place questions, asked while typing pauses so `messages.check` finds the answer. */
export const messagesPrecheck = Rpc.make('messages.precheck', {
  payload: { channelId: Schema.String, threadTs: Schema.optionalKey(Schema.String), text: Schema.String },
  success: Schema.Void,
})

/** The draft of one topic, `''` when it has none. */
export const draftsGet = liveValueRoute('drafts.get', { payload: { topicId: Schema.String }, value: Schema.String })

/** Replaces a topic's draft; an empty or blank text deletes it. */
export const draftsSet = Rpc.make('drafts.set', { payload: { topicId: Schema.String, text: Schema.String }, success: Schema.Void, error: NotSignedIn })

export const SendRoutes = RpcGroup.make(messagesSend, messagesRetry, messagesDiscard, messagesEdit, messagesDelete, messagesReact, messagesCheck, messagesPrecheck, draftsGet, draftsSet)
