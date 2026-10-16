/**
 * New chat (spec section 9, inventory 8): destinations and the two pickers.
 *
 * Live queries, which never call Slack:
 * - `newChat.conversations`: the conversation picker's sections. With an
 *   empty query, the recent conversations; with a query, the matching
 *   people (everyone in the workspace, including people never messaged)
 *   and the matching channels and group DMs you are in. Ignored channels
 *   are left out.
 * - `newChat.frequent`: up to six local destinations by decayed own sends,
 *   with member activity as the fallback, DMs first; no archived channels.
 * - `newChat.ranked`: the ⌘K Conversations tab (spec section 10). DMs,
 *   group DMs and channels by own sends and topic visits, decayed like
 *   `newChat.frequent`, then activity; with text, the conversations the
 *   picker finds for it, ranked the same way.
 * - `newChat.threads`: the thread picker's rows. With a channel, its
 *   threads by latest activity, followed or not; without one, recent
 *   threads from everywhere. Main is not a row: the renderer puts it first.
 *
 * Sending is `messages.send` in `send.ts`.
 */
import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { ContextTint, ConversationKind } from '@juno/domain'
import { liveValueRoute } from '../live'
import { Person } from '../refs'

/** A conversation the picker offers: a channel, a group DM, a DM, or a person with no DM yet. */
export const PickConversation = Schema.Struct({
  /** The channel id, or `u:<user id>` for a person with no DM yet. */
  key: Schema.String,
  /** "eng", "Maya Chen", "Maya, Leo": without "#". */
  name: Schema.String,
  /** A person with no DM yet is `im`. */
  kind: ConversationKind,
  tint: ContextTint,
  /** Absent for a person with no DM yet: sending opens one. */
  channelId: Schema.optionalKey(Schema.String),
  /** The conversation's Main topic id, with `channelId`. */
  mainId: Schema.optionalKey(Schema.String),
  /** The other person, for a DM or a person with no DM yet. */
  person: Schema.optionalKey(Person),
  /** Juno holds no message in it: "No messages yet" for a person. */
  empty: Schema.Boolean,
})
export type PickConversation = typeof PickConversation.Type

export const PickConversations = Schema.Struct({
  /** By latest activity, at most `RECENT_CONVERSATIONS`. Empty when there is a query. */
  recent: Schema.Array(PickConversation),
  people: Schema.Array(PickConversation),
  channels: Schema.Array(PickConversation),
})
export type PickConversations = typeof PickConversations.Type

/** Rows in the conversation picker's Recent section. */
export const RECENT_CONVERSATIONS = 8
/** Rows in each of the conversation picker's People and Channels sections, and in the thread picker. */
export const PICK_LIMIT = 20

export const newChatConversations = liveValueRoute('newChat.conversations', {
  payload: { query: Schema.String },
  value: PickConversations,
})

/** A thread the picker offers, with the conversation it lives in. */
export const PickThread = Schema.Struct({
  /** The thread's topic id. */
  id: Schema.String,
  rootTs: Schema.String,
  title: Schema.String,
  replyCount: Schema.Int,
  /** Epoch milliseconds of the latest activity. */
  lastActivityAt: Schema.Number,
  conversation: PickConversation,
})
export type PickThread = typeof PickThread.Type

export const newChatThreads = liveValueRoute('newChat.threads', {
  payload: { channel: Schema.optionalKey(Schema.String), query: Schema.String },
  value: Schema.Array(PickThread),
})


/** Up to six local destinations ranked by own recent sends, then activity. */
export const newChatFrequent = liveValueRoute('newChat.frequent', { value: Schema.Array(PickConversation) })

/** Rows `newChat.ranked` returns, with or without text. */
export const PALETTE_CONVERSATIONS = 12

/** The palette's Conversations tab. A person never messaged has the key `u:<user id>` and no `channelId`. */
export const newChatRanked = liveValueRoute('newChat.ranked', {
  payload: { query: Schema.String },
  value: Schema.Array(PickConversation),
})

export const NewChatRoutes = RpcGroup.make(newChatConversations, newChatThreads, newChatFrequent, newChatRanked)
