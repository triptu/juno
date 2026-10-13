/**
 * The topic view's data (M4; spec section 7; architecture 5.5 and 7).
 *
 * Live queries, which never call Slack:
 * - `messages.list`: a window of one topic's messages, oldest first, as
 *   `MessageView` rows. People are in `refs` (`senderId`).
 * - `topics.get`: the header of one topic, a `TopicDetail`.
 * - `channel.threads`: a channel's active threads, for the "Threads" button
 *   in Main's header, as `ThreadSummary` rows.
 *
 * Commands, which call Slack on the interactive lane:
 * - `topics.open`: fetch what the store is missing for a topic that is being
 *   opened, back to its read pointer (at most `OPEN_FETCH_MAX` messages).
 *   Call it once when a tab shows the topic; prefetch never calls it.
 * - `messages.loadOlder`: make sure the page before a message is stored,
 *   fetching it when it is not.
 *
 * Neither command fails because Slack could not be reached: the topic shows
 * what the store has, and `outcome` says what happened.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { TopicKind } from '@juno/domain'
import { MessageBody } from '../body'
import { NotFound } from '../errors'
import { liveListRoute, liveValueRoute, RowFields } from '../live'
import { RowChannel, TitleSource, TopicStatus } from './topics'

// Windows

/** Most rows a message window holds (performance 3.3). The engine caps `range.limit` here. */
export const MESSAGE_WINDOW_MAX = 500
/** The window a topic opens with when the container has no reason to pick another. */
export const MESSAGE_WINDOW_DEFAULT = 150
/** Rows before the anchor when the payload does not say (`messages.list` `before`). */
export const MESSAGE_WINDOW_BEFORE = 50
/** Messages `topics.open` fetches at most to reach the read pointer, so the "N new" count is exact. */
export const OPEN_FETCH_MAX = 500
/** Rows `channel.threads` returns at most. */
export const THREADS_WINDOW_MAX = 100

// Message rows

/** One reaction under a message. Read-only in M4. */
export const ReactionView = Schema.Struct({
  /** Slack's name, for example `+1` or a custom emoji's name. */
  name: Schema.String,
  count: Schema.Int,
  /** The signed-in user reacted with it. */
  me: Schema.Boolean,
  /** The emoji as text, for standard emoji. */
  unicode: Schema.optionalKey(Schema.String),
  /** The image, for custom emoji. A reaction with neither shows `:name:`. */
  url: Schema.optionalKey(Schema.String),
})
export type ReactionView = typeof ReactionView.Type

/**
 * A thumbnail the view can show at once with `aspect-ratio: width / height`
 * (performance 3.3: late images never move what the user reads).
 * `src` is `juno://files/<file id>/<variant>?url=<encoded Slack thumb url>`:
 * main serves it from the Slack session (architecture 9) and fetches only
 * Slack file hosts.
 */
export const FileThumb = Schema.Struct({
  src: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
})
export type FileThumb = typeof FileThumb.Type

export const FileKind = Schema.Literals(['image', 'video', 'audio', 'pdf', 'file', 'deleted'])
export type FileKind = typeof FileKind.Type

/**
 * A file on a message, for the file card. An image has `thumb` when Slack
 * made one; an image without dimensions, or any other file, is a card of
 * fixed height. `deleted` is a file Slack no longer serves.
 */
export const FileView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: FileKind,
  mimetype: Schema.optionalKey(Schema.String),
  /** Bytes. */
  size: Schema.optionalKey(Schema.Number),
  /** The original's dimensions, when Slack knows them. */
  width: Schema.optionalKey(Schema.Int),
  height: Schema.optionalKey(Schema.Int),
  thumb: Schema.optionalKey(FileThumb),
})
export type FileView = typeof FileView.Type

/** The link under a Main message that has a thread: "2 replies · Title ›" (inventory 6.7). */
export const ThreadLink = Schema.Struct({
  /** The thread's topic id, for opening it. */
  id: Schema.String,
  replyCount: Schema.Int,
  /** "2 replies", "1 reply", or "Thread" when only the root exists. */
  label: Schema.String,
  /** The thread's title: manual, AI, or the root's first words. */
  title: Schema.String,
  titleSource: TitleSource,
  /** Epoch milliseconds of the latest reply. */
  lastReplyAt: Schema.optionalKey(Schema.Number),
})
export type ThreadLink = typeof ThreadLink.Type

/**
 * - `message`: a message to show.
 * - `deleted`: a deleted root that keeps its place because it has replies.
 * - `unloaded`: a root the store knows only from its replies; it is being fetched.
 */
export const MessageKind = Schema.Literals(['message', 'deleted', 'unloaded'])
export type MessageKind = typeof MessageKind.Type

/**
 * One message row, shaped for the view. `id` is the message `ts`, unique in
 * a topic; `rev` changes whenever anything the row shows changes, except the
 * sender's name and photo, which are in `refs`.
 */
export const MessageView = Schema.Struct({
  ...RowFields,
  ts: Schema.String,
  /** Epoch milliseconds of `ts`, for the message time. */
  at: Schema.Number,
  kind: MessageKind,
  /** The sender, a `Person` in the window's `refs`. Absent for `unloaded`. */
  senderId: Schema.optionalKey(Schema.String),
  /** Sent by the signed-in user. */
  fromMe: Schema.Boolean,
  body: MessageBody,
  edited: Schema.Boolean,
  /**
   * The message starts a sender group and shows the name and avatar: a new
   * sender, a quote at the start, or the first row of the window. The "N new"
   * divider also starts a group; the view applies that one.
   */
  groupStart: Schema.Boolean,
  /** The message mentions the signed-in user (directly, a group of theirs, or @here and friends): the tinted row. */
  mentionsMe: Schema.Boolean,
  /** A thread reply also sent to the channel. */
  broadcast: Schema.Boolean,
  /** The thread's root, the first row of a thread. */
  root: Schema.Boolean,
  reactions: Schema.Array(ReactionView),
  files: Schema.Array(FileView),
  /** Main only: the message has a thread. */
  thread: Schema.optionalKey(ThreadLink),
})
export type MessageView = typeof MessageView.Type

/**
 * One topic's messages, oldest first.
 *
 * `range.anchor` is a message ts. Without it the window is the newest
 * `range.limit` messages (the bottom). With it the window is up to `before`
 * messages older than the anchor (default `MESSAGE_WINDOW_BEFORE`), then the
 * anchor and the newer messages, `range.limit` rows in all. `limit` is
 * capped at `MESSAGE_WINDOW_MAX`.
 *
 * - Open at the "N new" divider: anchor at the first unread message.
 * - Open at the bottom, and stick to it: no anchor.
 * - Older rows on scroll up: anchor at the first row shown, a larger
 *   `before` and `limit`, after `messages.loadOlder` says the page is stored.
 *
 * `meta.total` is the number of rows in the window.
 */
export const messagesList = liveListRoute('messages.list', {
  row: MessageView,
  payload: {
    /** The topic id: `t:<channel>:<thread ts>` or `m:<channel>`. */
    id: Schema.String,
    before: Schema.optionalKey(Schema.Int),
  },
})

// Topic header

/** What the topic header shows (inventory 5). A live value; `null` for a topic the store does not know. */
export const TopicDetail = Schema.Struct({
  id: Schema.String,
  kind: TopicKind,
  title: Schema.String,
  titleSource: TitleSource,
  channel: RowChannel,
  status: TopicStatus,
  /** Slack's follow flag for a thread, the client-only flag for Main (as on `TopicRow`). */
  subscribed: Schema.Boolean,
  pinned: Schema.Boolean,
  resolved: Schema.Boolean,
  messageCount: Schema.Int,
  unreadCount: Schema.Int,
  unreadExact: Schema.Boolean,
  mentionsMe: Schema.Boolean,
  /**
   * Juno's read pointer: messages after it are unread. The container
   * snapshots it when the tab opens, for the "N new" divider, so the divider
   * stays put when the topic is marked read. Absent when nothing is read.
   */
  lastReadTs: Schema.optionalKey(Schema.String),
  lastActivityTs: Schema.optionalKey(Schema.String),
  /** Threads: the root's ts. */
  rootTs: Schema.optionalKey(Schema.String),
  /** Main: the channel's threads with activity inside the quiet window, for the "Threads" button. */
  threadCount: Schema.optionalKey(Schema.Int),
  /** The topic's art as a recipe, as on `TopicRow.art`; the header and the tab draw it at 20 and 16px. Absent means the Tide placeholder. */
  art: Schema.optionalKey(Schema.String),
})
export type TopicDetail = typeof TopicDetail.Type

/** The header of one topic. Updates on any change to the topic, its overlay, read state, channel or follow flag. */
export const topicsGet = liveValueRoute('topics.get', { payload: { id: Schema.String }, value: Schema.NullOr(TopicDetail) })

// Active threads of a channel

/** One entry of Main's "Threads" list: title, reply count, time, unread count and the Subscribe bell. */
export const ThreadSummary = Schema.Struct({
  /** The thread's topic id. */
  ...RowFields,
  rootTs: Schema.String,
  title: Schema.String,
  titleSource: TitleSource,
  replyCount: Schema.Int,
  lastActivityTs: Schema.String,
  /** Epoch milliseconds of `lastActivityTs`. */
  lastActivityAt: Schema.Number,
  unreadCount: Schema.Int,
  unreadExact: Schema.Boolean,
  mentionsMe: Schema.Boolean,
  /** Slack's follow flag; the bell toggles it with `topics.subscribe` and `topics.unsubscribe`. */
  subscribed: Schema.Boolean,
  /** Most recent first, at most three, as `Person`s in `refs`. */
  participantIds: Schema.Array(Schema.String),
})
export type ThreadSummary = typeof ThreadSummary.Type

/**
 * A channel's threads with activity inside the quiet window, newest
 * activity first, at most `THREADS_WINDOW_MAX`. `range.anchor` is not used.
 * `meta.total` is the number of such threads.
 */
export const channelThreads = liveListRoute('channel.threads', { row: ThreadSummary, payload: { channel: Schema.String } })

// Commands

/**
 * What a fetch did. `fetched`: Slack answered and the store is up to date.
 * `cached`: nothing needed fetching. The others: Slack could not be asked,
 * and the topic shows what the store has. After `rate-limited` the engine
 * fetches again on the background lane by itself.
 */
export const FetchOutcome = Schema.Literals(['fetched', 'cached', 'offline', 'rate-limited', 'signed-out', 'rejected'])
export type FetchOutcome = typeof FetchOutcome.Type

export const OpenResult = Schema.Struct({ outcome: FetchOutcome })
export type OpenResult = typeof OpenResult.Type

/**
 * Fetches what the store is missing for a topic being opened: a thread's
 * replies (all of them the first time, then the new ones), or Main's
 * history since the store last read it, in both cases back to the read
 * pointer so the "N new" count is exact. Fails only for an id that is not a
 * topic. Opening an uncached topic offline answers `offline`; the header
 * and an empty list stay usable.
 */
export const topicsOpen = Rpc.make('topics.open', { payload: { id: Schema.String }, success: OpenResult, error: NotFound })

export const OlderResult = Schema.Struct({
  outcome: FetchOutcome,
  /** Nothing older exists: the store holds the topic from its first message. Stop asking. */
  complete: Schema.Boolean,
})
export type OlderResult = typeof OlderResult.Type

/**
 * Makes sure the page of messages before `before` (a message ts) is
 * stored, fetching it on the interactive lane when it is not. The window
 * itself does not move; the container then widens `messages.list`.
 */
export const messagesLoadOlder = Rpc.make('messages.loadOlder', {
  payload: { id: Schema.String, before: Schema.String },
  success: OlderResult,
  error: NotFound,
})

export const MessagesRoutes = RpcGroup.make(messagesList, topicsGet, channelThreads, topicsOpen, messagesLoadOlder)
