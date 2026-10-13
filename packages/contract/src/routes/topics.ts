/**
 * Topic routes (architecture 4.4, 7 and 16 M3; spec section 5).
 *
 * `topics.list` is the sidebar: a windowed list of topic rows already shaped
 * for a row, so the renderer draws and never computes. Pinned rows come
 * first, then Recent, both by latest activity. `topics.counts` feeds the
 * small dots after the Channels and DMs filters.
 *
 * `topics.subscribe` and `topics.unsubscribe` are the first commands: one
 * local transaction, then the mirror to Slack for a thread. They return the
 * undo the engine computed (ADR 0010).
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotFound, NotSignedIn, Offline, RateLimited, Rejected } from '../errors'
import { liveListRoute, liveValueRoute, RowFields } from '../live'

export const TopicKind = Schema.Literals(['thread', 'main', 'group'])
export type TopicKind = typeof TopicKind.Type

export const ConversationKind = Schema.Literals(['public', 'private', 'im', 'mpim'])
export type ConversationKind = typeof ConversationKind.Type

/** Which tint a context pill or a channel label gets: neutral, amber or blue. */
export const ContextTint = Schema.Literals(['public', 'private', 'dm'])
export type ContextTint = typeof ContextTint.Type

export const TitleSource = Schema.Literals(['manual', 'ai', 'fallback', 'channel'])
export type TitleSource = typeof TitleSource.Type

export const TopicStatus = Schema.Literals(['open', 'quiet', 'resolved', 'unsubscribed'])
export type TopicStatus = typeof TopicStatus.Type

export const RowTag = Schema.Literals(['main', 'reopened', 'unsubscribed'])
export type RowTag = typeof RowTag.Type

export const SidebarSection = Schema.Literals(['pinned', 'recent'])
export type SidebarSection = typeof SidebarSection.Type

/** A person on a row: the participant stack, a DM partner. `avatarUrl` is the Slack profile photo when there is one. */
export const Person = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.optionalKey(Schema.String),
  /** Hue for the initials when there is no photo (`--hue-<color>`). */
  color: Schema.String,
})
export type Person = typeof Person.Type

/** Where a topic lives, with everything the tile and line three need. */
export const RowChannel = Schema.Struct({
  id: Schema.String,
  kind: ConversationKind,
  /** "eng", "Maya Chen", "Maya, Leo": the text next to the icon, without "#". */
  name: Schema.String,
  /** "#eng", "Maya Chen": the text a toast or tab uses. */
  label: Schema.String,
  tint: ContextTint,
  /** Lucide icon for the channel tile and line three. DMs use the avatar instead. */
  icon: Schema.String,
  /** Hue name for the tile (`--hue-<color>`), from the channel id until the user picks one. */
  color: Schema.String,
  /** The other person in a DM, for the tile. */
  partner: Schema.optionalKey(Person),
})
export type RowChannel = typeof RowChannel.Type

export const TopicPreview = Schema.Struct({
  /** "You" for own messages, otherwise the sender's display name. */
  sender: Schema.String,
  /** Latest message with quote lines stripped. May be empty. */
  text: Schema.String,
  /** "Sender: text", or just the sender when the text is empty. */
  line: Schema.String,
})
export type TopicPreview = typeof TopicPreview.Type

/** One sidebar row. Flat, JSON-shaped, no histories (performance 2.2). */
export const TopicRow = Schema.Struct({
  ...RowFields,
  kind: TopicKind,
  section: SidebarSection,
  status: TopicStatus,
  title: Schema.String,
  titleSource: TitleSource,
  preview: TopicPreview,
  channel: RowChannel,
  /** Most recent first, at most four. */
  participants: Schema.Array(Person),
  messageCount: Schema.Int,
  unreadCount: Schema.Int,
  /** False when the count is a lower bound and the row should show a dot. */
  unreadExact: Schema.Boolean,
  mentionsMe: Schema.Boolean,
  tags: Schema.Array(RowTag),
  pinned: Schema.Boolean,
  /** Resolved and pinned: dimmed with a check, no hover Resolve. */
  resolved: Schema.Boolean,
  canResolveOnHover: Schema.Boolean,
  /**
   * What Subscribe and Unsubscribe toggle: Slack's follow flag for a thread
   * (true means Slack lists it as followed), the client-only flag for Main
   * (true unless the user unsubscribed it). The menu offers Unsubscribe when true.
   */
  subscribed: Schema.Boolean,
  lastActivityTs: Schema.String,
  /** Epoch milliseconds of `lastActivityTs`, for the relative time. */
  lastActivityAt: Schema.Number,
})
export type TopicRow = typeof TopicRow.Type

export const KindFilter = Schema.Literals(['all', 'channels', 'dms'])
export type KindFilter = typeof KindFilter.Type

/** The quick filters and the scope chip (spec section 5). */
export const TopicListFilter = {
  kind: KindFilter,
  unreadOnly: Schema.Boolean,
  /** Narrowed to one channel from Browse or ⌘K. */
  scope: Schema.optionalKey(Schema.String),
}

/** The sidebar list. Window of 300 rows, pinned first, then recent by latest activity. */
export const topicsList = liveListRoute('topics.list', { row: TopicRow, payload: TopicListFilter })

export const TopicCounts = Schema.Struct({
  /** Unread topics the sidebar would show, per group, within the scope. */
  channelsUnread: Schema.Int,
  dmsUnread: Schema.Int,
})
export type TopicCounts = typeof TopicCounts.Type

/** Counts for the filter dots: a dot shows next to a group that has unread topics and is not selected. */
export const topicsCounts = liveValueRoute('topics.counts', { value: TopicCounts, payload: { scope: Schema.optionalKey(Schema.String) } })

// Commands

/**
 * A command the renderer can replay as it is: the undo of another command
 * (ADR 0010). The undo stack stores these and writes the matching command
 * atom on ⌘Z or the toast's Undo. Later commands add their shape here.
 */
export const UndoCommand = Schema.Union([
  Schema.TaggedStruct('topics.subscribe', { id: Schema.String }),
  Schema.TaggedStruct('topics.unsubscribe', { id: Schema.String }),
])
export type UndoCommand = typeof UndoCommand.Type

/** What a command returns: the undo computed from the state before the change, when there is one. */
export const CommandResult = Schema.Struct({ undo: Schema.optionalKey(UndoCommand) })
export type CommandResult = typeof CommandResult.Type

/**
 * Why a subscribe or unsubscribe did not stick. The local change is already
 * reverted when one of these arrives. `NotFound` is a topic id the store does
 * not know; the others are Slack's answer to the mirror call of a thread.
 */
export const SubscribeError = Schema.Union([NotSignedIn, NotFound, Rejected, RateLimited, Offline])
export type SubscribeError = typeof SubscribeError.Type

const topicPayload = { id: Schema.String }

/**
 * Follows a thread in Slack ("Get notified about new replies") and shows it
 * in the sidebar, or un-hides a Main. Returns an undo when something changed.
 */
export const topicsSubscribe = Rpc.make('topics.subscribe', { payload: topicPayload, success: CommandResult, error: SubscribeError })

/** Unfollows a thread in Slack, or hides a Main (client-only). Returns an undo that subscribes again. */
export const topicsUnsubscribe = Rpc.make('topics.unsubscribe', { payload: topicPayload, success: CommandResult, error: SubscribeError })

export const TopicsRoutes = RpcGroup.make(topicsList, topicsCounts, topicsSubscribe, topicsUnsubscribe)
