/**
 * Destinations for Home's composer (spec section 12, "Writing"): the
 * conversation list, Recent and ⌘K's Conversations tab. The route names
 * keep the New chat prefix they were built with.
 *
 * Live queries, which never call Slack:
 * - `newChat.conversations`: the destination list's sections. With an
 *   empty query, the recent conversations; with a query, the matching
 *   people (everyone in the workspace, including people never messaged)
 *   and the matching channels and group DMs you are in. Ignored channels
 *   are left out.
 * - `newChat.frequent`: Home's Recent, up to five people then five
 *   channels by decayed own sends, with member activity as the fallback; no
 *   archived channels.
 * - `newChat.ranked`: the ⌘K Conversations tab (spec section 10). DMs,
 *   group DMs and channels by own sends and topic visits, decayed like
 *   `newChat.frequent`, then activity; with text, the conversations the
 *   picker finds for it, by how well they match, then ranked the same way.
 *
 * With text, both search by words (`conversation-search.ts` in
 * `@juno/domain`): each typed word matches the start of a word of the
 * name, a person's names or a channel's words, in any order, then inside
 * a word, then with one typo.
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
  /**
   * A channel's tile: its Main's art recipe, as the sidebar's Main row draws
   * it. Absent until the art is drawn or while AI assist is off, when the
   * tile is the Tide placeholder seeded by `mainId`. Never set for DMs and
   * group DMs, which draw people.
   */
  art: Schema.optionalKey(Schema.String),
  /** Juno holds no message in it: "No messages yet" for a person. */
  empty: Schema.Boolean,
  /** With text, the parts of `name` the text matched, as [start, end) offsets, for the row to highlight. */
  highlight: Schema.optionalKey(Schema.Array(Schema.Tuple([Schema.Int, Schema.Int]))),
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
/** Rows in each of the destination list's People and Channels sections. */
export const PICK_LIMIT = 20

export const newChatConversations = liveValueRoute('newChat.conversations', {
  payload: { query: Schema.String },
  value: PickConversations,
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

export const NewChatRoutes = RpcGroup.make(newChatConversations, newChatFrequent, newChatRanked)
