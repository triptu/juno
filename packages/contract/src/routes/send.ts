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
 * - `messages.forward`: queues a forward of a stored message to a
 *   channel's or a person's Main, with an optional note, the same way:
 *   a pending row in the destination that the outbox posts with
 *   `chat.shareMessage` (spec section 7, "Forward").
 * - `messages.retry`: Retry on a failed row. It is queued again.
 * - `messages.discard`: Delete draft on a failed row. It is removed.
 * - `messages.edit`, `messages.delete`: the user's own message, from the
 *   hover toolbar's More menu, the message menu or the keyboard. Both write
 *   locally and answer at once: the list shows the change straight away and
 *   the outbox sends it. A message Slack may not have yet waits for it
 *   (`depends_on`). Neither has an undo (ADR 0010).
 * - `messages.react`: adds or removes the user's reaction, the same way.
 * - `messages.broadcast`: also sends the user's own thread reply to the
 *   channel (Slack's "also send to the channel"), the same way: Main shows
 *   the reply at once and the outbox sends it with `chat.update`.
 * - `messages.attachmentAction`: presses a button in a message, such as
 *   Slackbot's Add them or Dismiss. Unlike the commands above it calls Slack
 *   before it answers, once, and writes nothing locally: Slack sends what
 *   the press changed on the socket.
 * - `messages.precheck`: while typing pauses in Main, asks the route model
 *   whether the draft reads like a reply to one of the channel's latest
 *   topics (`routeCheck`) and stores the answer. Nothing else is asked while
 *   typing.
 * - `messages.check`: the checks on send (spec section 8), run on Enter
 *   before `messages.send`. It never waits for a model: the wrong-place
 *   finding is the precheck's stored answer for this exact draft, if there
 *   is one. Empty when nothing was found: the message then just sends.
 * - `messages.postcheck`: once a send is accepted, the local fixes for the
 *   sent text at once, and the grammar request for it started.
 * - `messages.grammar`: waits for that grammar answer and returns it merged
 *   with the local fixes. Neither holds the send.
 *
 * A message Slack refuses to change (too old to edit, say) goes back to
 * what Slack has.
 *
 * Drafts, kept per topic in `user.db` so they outlive the app, and synced
 * with Slack's drafts for the topic's conversation or thread (SPEC 8):
 * - `drafts.get`: the topic's draft, `''` when it has none (a live value).
 *   A draft changed on another device shows here, with the local text it
 *   replaced when that text had not reached Slack yet.
 * - `drafts.set`: replaces it; `''` deletes it. The change goes to Slack
 *   after a pause in typing, or at once with `now` (the field lost focus,
 *   the tab hid, the window is closing).
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
  /** The thread or Main; a root sent from Home starts with its durable pending topic identity. */
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
    /** Main sends from Home in channels and group DMs open a locally followed thread. */
    startThread: Schema.optionalKey(Schema.Boolean),
    files: Schema.optionalKey(Schema.Array(Schema.String)),
  },
  success: SendResult,
  error: SendError,
})

/**
 * Forward the stored message `source` (not a pending one) to `to`'s Main,
 * with `note` above it; the note may be empty. `clientMsgId` is the
 * renderer's, as for `messages.send`. `NotFound` when the message is not
 * stored or is not in Slack yet; `Rejected` `invalid_target` for a thread.
 */
export const messagesForward = Rpc.make('messages.forward', {
  payload: {
    to: SendTarget,
    note: Schema.String,
    clientMsgId: Schema.String,
    source: Schema.Struct({ channelId: Schema.String, ts: Schema.String }),
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

/**
 * Also send an own thread reply to the channel. `NotFound` when it is gone,
 * not the user's, not a reply, or not in Slack yet. A reply already sent
 * changes nothing.
 */
export const messagesBroadcast = Rpc.make('messages.broadcast', { payload: { message: MessageRef }, success: Schema.Void, error: MessageActionError })

/**
 * Press a button in a message's body (a `buttons` block's `attachment` and
 * button `id`). Sent to Slack once, as the official client sends it; what
 * Slack does with the message (replaces or removes it) comes on the socket.
 * `NotFound` when the message or the button is gone.
 */
export const messagesAttachmentAction = Rpc.make('messages.attachmentAction', {
  payload: { message: MessageRef, attachment: Schema.String, button: Schema.String },
  success: Schema.Void,
  error: SendError,
})

/** Retry or dismiss a failed edit, delete or broadcast without rebuilding its saved intent. */
export const messagesResolveAction = Rpc.make('messages.resolveAction', {
  payload: { id: Schema.Int, retry: Schema.Boolean }, success: Schema.Void, error: NotSignedIn,
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

/** Asked while typing pauses in Main: the wrong-place question, so `messages.check` finds the answer. */
export const messagesPrecheck = Rpc.make('messages.precheck', {
  payload: { channelId: Schema.String, threadTs: Schema.optionalKey(Schema.String), text: Schema.String },
  success: Schema.Void,
})

/**
 * The local fixes for a message this renderer just sent, at once. `grammar` is true when a grammar answer
 * is on its way: `messages.grammar` waits for it. Empty for a message sent too long ago or in another workspace.
 */
export const messagesPostcheck = Rpc.make('messages.postcheck', {
  payload: { clientMsgId: Schema.String },
  success: Schema.Struct({ ...SendCheck.fields, grammar: Schema.Boolean }),
})

/** The grammar answer for a message `messages.postcheck` started, merged with the local fixes. Empty when grammar found nothing. */
export const messagesGrammar = Rpc.make('messages.grammar', {
  payload: { clientMsgId: Schema.String },
  success: SendCheck,
})

/**
 * The draft of one topic: its text, `''` when it has none, and a local text not yet in Slack that a newer
 * version from another device replaced (`replaced`), which ⌘Z in the composer brings back.
 */
export const StoredDraft = Schema.Struct({ text: Schema.String, replaced: Schema.optionalKey(Schema.String) })
export type StoredDraft = typeof StoredDraft.Type

export const draftsGet = liveValueRoute('drafts.get', { payload: { topicId: Schema.String }, value: StoredDraft })

/** Replaces a topic's draft; an empty or blank text deletes it. With `now`, Slack gets it without waiting for a pause in typing. */
export const draftsSet = Rpc.make('drafts.set', { payload: { topicId: Schema.String, text: Schema.String, now: Schema.optionalKey(Schema.Boolean) }, success: Schema.Void, error: NotSignedIn })

export const SendRoutes = RpcGroup.make(messagesResolveAction, messagesAttachmentAction, messagesSend, messagesForward, messagesRetry, messagesDiscard, messagesEdit, messagesDelete, messagesBroadcast, messagesReact, messagesCheck, messagesPrecheck, messagesPostcheck, messagesGrammar, draftsGet, draftsSet)
