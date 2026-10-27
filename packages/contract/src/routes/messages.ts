/**
 * The topic view's data (M4; spec section 7; architecture 5.5 and 7).
 *
 * Live queries, which never call Slack:
 * - `messages.list`: a window of one topic's messages, oldest first, as
 *   `MessageView` rows. People are in `refs` (`senderId`).
 * - `topics.get`: the header of one topic, a `TopicDetail`.
 * - `channel.threads`: a channel's threads, for the "Threads" button in
 *   Main's header, the topic switcher and Home's topic chip, as
 *   `ThreadSummary` rows.
 *
 * Commands, which call Slack on the interactive lane:
 * - `topics.open`: fetch what the store is missing for a topic that is being
 *   opened, back to its read pointer (at most `OPEN_FETCH_MAX` messages).
 *   Call it once when a tab shows the topic; prefetch never calls it.
 * - `messages.loadOlder`: make sure the page before a message is stored,
 *   fetching it when it is not.
 * - `messages.loadNewer`: make sure the replies after a thread's last shown
 *   row are stored, when the store cannot prove them (`meta.gapAfter`).
 * - `messages.loadAt`: make sure one message is stored in full, for a jump
 *   to it (a search match, a link, a cited message).
 *
 * Neither command fails because Slack could not be reached: the topic shows
 * what the store has, and `outcome` says what happened.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { TopicKind } from '@juno/domain'
import { MessageBody } from '../body'
import { Person } from '../refs'
import { NotFound, NotSignedIn } from '../errors'
import { liveListRoute, liveValueRoute, RowFields } from '../live'
import { FileView } from './files'
import { RowChannel, TitleSource, TopicStatus } from './topics'

// Windows

/** Most rows a message window holds (performance 3.3). The engine caps `range.limit` here. */
export const MESSAGE_WINDOW_MAX = 500
/** The window a topic opens with when the container has no reason to pick another. */
export const MESSAGE_WINDOW_DEFAULT = 150
/** Rows before the anchor when the payload does not say (`messages.list` `before`). */
export const MESSAGE_WINDOW_BEFORE = 50
/** Rows `channel.threads` returns at most. */
export const THREADS_WINDOW_MAX = 100

// Message rows

/** One reaction under a message. Its chip toggles the user's own (`messages.react`). */
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
  /**
   * Who reacted, as user ids in the window's `refs.people`: you first when
   * `me`, then the others in Slack's order, at most ten. Slack may list fewer
   * than `count`; the rest are "and N others".
   */
  users: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type ReactionView = typeof ReactionView.Type

/**
 * The user's own reaction change that Slack has not taken (architecture
 * 5.7). `failed`: Slack refused it; the chip shows what Slack has, and the
 * message offers Retry and Remove. `waiting`: it has not gone out for a
 * while (no connection, or its message is still being sent); the chip
 * shows the change.
 */
export const ReactionIssue = Schema.Struct({
  id: Schema.Number,
  /** Stable for one attempt, shared by every view of the message. */
  key: Schema.String,
  name: Schema.String,
  /** The change asked for: add (`true`) or remove. */
  on: Schema.Boolean,
  state: Schema.Literals(['failed', 'waiting']),
})
export type ReactionIssue = typeof ReactionIssue.Type

/** Main thread link (inventory 6.7). replierIds are the first three Slack reply_users, joined through refs.people. */
export const ThreadLink = Schema.Struct({
  /** The thread's topic id, for opening it. */
  id: Schema.String,
  replyCount: Schema.Int,
  /** "2 replies", "1 reply", or "Thread" when only the root exists. */
  label: Schema.String,
  /** The first reply's plain-text prefix, with its sender when known. Absent until known locally. */
  preview: Schema.optionalKey(Schema.String),
  replierIds: Schema.optionalKey(Schema.Array(Schema.String)),
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
 * One of Juno's own messages that Slack does not hold yet (architecture
 * 5.7): `sending` until Slack has it, when the row becomes the message;
 * `failed` when Slack refused it, with Retry and Delete draft.
 */
export const PendingState = Schema.Literals(['sending', 'failed'])
export type PendingState = typeof PendingState.Type

/** The `id` and `ts` of a pending row. Never a Slack ts, so never an anchor or a read pointer. */
export const pendingRowId = (clientMsgId: string): string => `pending:${clientMsgId}`

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
  /** A thread reply also sent to the channel. */
  broadcast: Schema.Boolean,
  /** The thread's root, the first row of a thread. */
  root: Schema.Boolean,
  reactions: Schema.Array(ReactionView),
  /** The newest of the user's reaction changes Slack has not taken, when there is one. */
  reactionIssue: Schema.optionalKey(ReactionIssue),
  actionIssue: Schema.optionalKey(Schema.Struct({ id: Schema.Int, kind: Schema.Literals(['edit', 'delete', 'broadcast']) })),
  files: Schema.Array(FileView),
  /** Main only: the message has a thread. */
  thread: Schema.optionalKey(ThreadLink),
  /**
   * Main only: a thread reply also sent to the channel. `id` is the thread's
   * topic; `preview` its resolved topic title's text, when the store has it.
   */
  broadcastFrom: Schema.optionalKey(Schema.Struct({ id: Schema.String, title: Schema.String, sensitive: Schema.Boolean })),
  /**
   * The `client_msg_id` the sending client gave the message. The view keys
   * rows by it when present, so a pending row becomes the stored message in
   * place.
   */
  clientMsgId: Schema.optionalKey(Schema.String),
  /**
   * A message Juno is sending. Pending rows come after every stored message
   * of a window that reaches the newest one; `id` and `ts` are
   * `pending:<clientMsgId>` and `at` is when it was sent. Never an anchor or
   * a read pointer.
   */
  pending: Schema.optionalKey(PendingState),
  /**
   * The user's own message as composer text ("@Maya Chen", "> " quote
   * lines), what the inline edit field starts with. Only on the user's own
   * messages that can be edited.
   */
  editText: Schema.optionalKey(Schema.String),
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
  /** Slack's follow flag for a thread, false for Main (as on `TopicRow`). */
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
  /** Set by Mark as unread until the topic is next marked read. The open topic stays unread while it is set (SPEC 7). Absent means no. */
  markedUnread: Schema.optionalKey(Schema.Boolean),
  lastActivityTs: Schema.optionalKey(Schema.String),
  /** Threads: the root's ts. */
  rootTs: Schema.optionalKey(Schema.String),
  /** Main: the channel's threads with activity inside the quiet window, for the "Threads" button. */
  threadCount: Schema.optionalKey(Schema.Int),
  /** The topic's art as a recipe, as on `TopicRow.art`; the header and the tab draw it at 20 and 16px. Absent means the Tide placeholder. */
  art: Schema.optionalKey(Schema.String),
  /** A DM, or a thread in one, with a person whose account is deactivated: it can be read, not written to (SPEC 7, "People"). */
  deactivated: Schema.optionalKey(Schema.Literal(true)),
  /**
   * A channel's topic you are not in (SPEC 7, "Not in the channel"):
   * `preview` for a public one, read-only with Join channel; `left` for a
   * private one you left, which shows no messages. Absent while you are in it.
   */
  notMember: Schema.optionalKey(Schema.Literals(['preview', 'left'])),
})
export type TopicDetail = typeof TopicDetail.Type

/** The header of one topic. Updates on any change to the topic, its overlay, read state, channel or follow flag. */
export const topicsGet = liveValueRoute('topics.get', { payload: { id: Schema.String }, value: Schema.NullOr(TopicDetail) })

// Active threads of a channel

/** One entry of Main's "Threads" list: title, reply count, time and unread count. */
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
  /** Most recent first, at most three, as `Person`s in `refs`. */
  participantIds: Schema.Array(Schema.String),
  /** Resolved with no activity since; only sent with `all`. */
  resolved: Schema.optionalKey(Schema.Boolean),
  /** The thread's art as a recipe, as on `TopicRow.art`; Home's topic list draws it. Absent means the placeholder. */
  art: Schema.optionalKey(Schema.String),
})
export type ThreadSummary = typeof ThreadSummary.Type

/**
 * A channel's threads with activity inside the quiet window, newest
 * activity first, at most `THREADS_WINDOW_MAX`. `range.anchor` is not used.
 * `meta.total` is the number of such threads. With `all` (the header's
 * topic switcher), every thread the store knows, open ones first and the
 * resolved ones after them, each newest first.
 */
export const channelThreads = liveListRoute('channel.threads', { row: ThreadSummary, payload: { channel: Schema.String, all: Schema.optionalKey(Schema.Boolean) } })

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

export const NewerResult = Schema.Struct({
  outcome: FetchOutcome,
  /** Nothing after `after` is unknown: the window can show the thread to its newest reply. Stop asking. */
  complete: Schema.Boolean,
})
export type NewerResult = typeof NewerResult.Type

/**
 * Makes sure the replies after `after` (a thread's last shown row) are
 * stored, fetching one page on the interactive lane when the store cannot
 * prove them. Main answers `cached`: its window ends at its newest message.
 * The container then widens `messages.list`.
 */
export const messagesLoadNewer = Rpc.make('messages.loadNewer', {
  payload: { id: Schema.String, after: Schema.String },
  success: NewerResult,
  error: NotFound,
})

/**
 * Makes sure the message `ts` of a topic is stored in full, fetching it on
 * the interactive lane when it is not: a bounded read around it, whatever
 * its distance from the stored messages. The container then moves the
 * window to it.
 */
export const messagesLoadAt = Rpc.make('messages.loadAt', {
  payload: { id: Schema.String, ts: Schema.String },
  success: OpenResult,
  error: NotFound,
})

/**
 * The topic that holds a message, from the store: its thread when it is a
 * reply or a thread's root, else the channel's Main. A message the store
 * does not have is placed in Main. For a Juno source link (SPEC 13.1), which
 * names only the channel and the message, and a Slack link in a message
 * (SPEC 8, "Links"), which may also name the thread.
 */
export const messagesLocate = Rpc.make('messages.locate', {
  /** Without `ts`, a link to the channel: its Main. */
  payload: { channel: Schema.String, ts: Schema.optionalKey(Schema.String), threadTs: Schema.optionalKey(Schema.String) },
  success: Schema.Struct({
    topicId: Schema.String,
    /** The store holds the message, so the topic can open at it without asking Slack. */
    stored: Schema.Boolean,
    /** "#eng", "Maya Chen": the conversation's label. Absent when the store does not know the conversation, so Juno cannot open it. */
    place: Schema.optionalKey(Schema.String),
  }),
  error: NotSignedIn,
})

/**
 * A person a Slack profile link names (SPEC 8, "Links"): your DM with them
 * when you have one. `person` is absent when the store does not know them,
 * or they are deactivated and you have no DM with them.
 */
export const peopleLocate = Rpc.make('people.locate', {
  payload: { user: Schema.String },
  success: Schema.Struct({ person: Schema.optionalKey(Person), mainId: Schema.optionalKey(Schema.String) }),
  error: NotSignedIn,
})

export const MessagesRoutes = RpcGroup.make(messagesList, topicsGet, channelThreads, topicsOpen, messagesLoadOlder, messagesLoadNewer, messagesLoadAt, messagesLocate, peopleLocate)
