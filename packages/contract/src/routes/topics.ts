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
import { AllTopicsStatus, ChannelColor, ChannelIcon, ContextTint, ConversationKind, RowTag, TopicKind } from '@juno/domain'
import { NotFound, NotSignedIn, Offline, RateLimited, Rejected } from '../errors'
import { liveListRoute, liveValueRoute, RowFields } from '../live'
import { ChannelRef, Person } from '../refs'

// The vocabulary is `@juno/domain`'s. It is re-exported so a renderer package
// that may not import domain still names the same literals.
export { ChannelColor, ChannelIcon, ContextTint, ConversationKind, RowTag, TopicKind }
/** The status a sidebar row shows. `ignored` never reaches a row. */
export const TopicStatus = AllTopicsStatus
export type TopicStatus = typeof TopicStatus.Type

export const TitleSource = Schema.Literals(['manual', 'ai', 'fallback', 'channel'])
export type TitleSource = typeof TitleSource.Type

/** The sidebar holds at most this many rows (performance 3.2). The engine caps `range.limit` here; the renderer asks for it. */
export const SIDEBAR_WINDOW = 300

export const SidebarSection = Schema.Literals(['pinned', 'recent'])
export type SidebarSection = typeof SidebarSection.Type

const { partnerId: _partnerId, ...channelFields } = ChannelRef.fields

/** Where a topic lives, with everything the tile and line three need: a `ChannelRef` with the DM partner joined in. */
export const RowChannel = Schema.Struct({
  ...channelFields,
  /** The other person in a DM, for the tile. */
  partner: Schema.optionalKey(Person),
})
export type RowChannel = typeof RowChannel.Type

/** The row's preview. The view joins them as "Sender: text", or shows the sender alone when the text is empty. */
export const TopicPreview = Schema.Struct({
  /** "You" for own messages, otherwise the sender's display name. */
  sender: Schema.String,
  /** Latest message with quote lines stripped. May be empty. */
  text: Schema.String,
})
export type TopicPreview = typeof TopicPreview.Type

/** What every sidebar row says about itself, on the wire and in the view. */
const TopicRowFields = {
  ...RowFields,
  kind: TopicKind,
  section: SidebarSection,
  status: TopicStatus,
  title: Schema.String,
  titleSource: TitleSource,
  preview: TopicPreview,
  messageCount: Schema.Int,
  unreadCount: Schema.Int,
  /** False when the count is a lower bound and the row should show a dot. */
  unreadExact: Schema.Boolean,
  mentionsMe: Schema.Boolean,
  tags: Schema.Array(RowTag),
  pinned: Schema.Boolean,
  /** Resolved and pinned: quieter, with a check, no hover Resolve. */
  resolved: Schema.Boolean,
  canResolveOnHover: Schema.Boolean,
  /**
   * What Subscribe and Unsubscribe toggle: Slack's follow flag for a thread
   * (true means Slack lists it as followed), the client-only flag for Main
   * (true unless the user unsubscribed it). The menu offers Unsubscribe when true.
   */
  subscribed: Schema.Boolean,
  /** Main rows: threads started in the channel since Main was last read ("2 new threads"). 0 for a thread, and for a Main never read. */
  newThreads: Schema.Int,
  lastActivityTs: Schema.String,
  /** Epoch milliseconds of `lastActivityTs`, for the relative time. */
  lastActivityAt: Schema.Number,
}

/**
 * One sidebar row as the view gets it: flat, JSON-shaped, no histories
 * (performance 2.2), with its channel and people joined in. `@juno/state`
 * builds it from a `TopicListRow` and the window's `refs`; the row's
 * object changes when the row's `rev` or anything it names changes.
 */
export const TopicRow = Schema.Struct({
  ...TopicRowFields,
  channel: RowChannel,
  /** Most recent first, at most four. */
  participants: Schema.Array(Person),
  /**
   * The topic's art as a recipe (`@juno/topic-art`), joined from the
   * window's `refs.art`. Absent while the art is not drawn yet, when the
   * model was not confident, or when AI assist is off: the tile then shows
   * the Tide placeholder. A DM's Main never has one; it shows the photo.
   */
  art: Schema.optionalKey(Schema.String),
})
export type TopicRow = typeof TopicRow.Type

/**
 * One sidebar row on the wire: a `TopicRow` that names its channel and
 * people by id. They travel in the delta's `refs` (`ChannelRef`, `Person`),
 * once per subscription and again when they change, so a 300-row window
 * does not repeat them and a new photo does not change any row's `rev`.
 */
export const TopicListRow = Schema.Struct({
  ...TopicRowFields,
  channelId: Schema.String,
  /** Most recent first, at most four. */
  participantIds: Schema.Array(Schema.String),
})
export type TopicListRow = typeof TopicListRow.Type

export const KindFilter = Schema.Literals(['all', 'channels', 'dms'])
export type KindFilter = typeof KindFilter.Type

/** The quick filters and the scope chip (spec section 5). */
export const TopicListFilter = {
  kind: KindFilter,
  unreadOnly: Schema.Boolean,
  /** Narrowed to one channel from Browse or ⌘K. */
  scope: Schema.optionalKey(Schema.String),
}

/** The sidebar list. Window of 300 rows, pinned first, then recent by latest activity. Rows name their channel and people; both are in `refs`. */
export const topicsList = liveListRoute('topics.list', { row: TopicListRow, payload: TopicListFilter })

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
  Schema.TaggedStruct('reads.markRead', { id: Schema.String, upTo: Schema.optionalKey(Schema.String) }),
  Schema.TaggedStruct('reads.markUnread', { id: Schema.String, from: Schema.optionalKey(Schema.String) }),
])
export type UndoCommand = typeof UndoCommand.Type

/** What a command returns: the undo computed from the state before the change, when there is one. */
export const CommandResult = Schema.Struct({ undo: Schema.optionalKey(UndoCommand) })
export type CommandResult = typeof CommandResult.Type

/**
 * Why a subscribe or unsubscribe may not have stuck. When one of these
 * arrives the thread shows what Slack said when asked afterwards; if Slack
 * could not be asked, it keeps the change until Slack answers, since the call
 * may have reached Slack. `NotFound` is a topic id the store does not know;
 * the others are Slack's answer to the mirror call of a thread.
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
