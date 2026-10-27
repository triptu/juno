/**
 * Topic routes (architecture 4.4, 7 and 16 M3; spec section 5).
 *
 * `topics.list` is the sidebar: a windowed list of topic rows already shaped
 * for a row, so the renderer draws and never computes. Pinned rows come
 * first, then Recent, both by latest activity. `topics.counts` feeds the
 * small dots after the Channels and DMs filters.
 *
 * `topics.subscribe` and `topics.unsubscribe` follow and unfollow a thread:
 * one local transaction, then the mirror to Slack. The topic actions
 * (resolve, reopen, pin, unpin, rename) and ignoring a channel are local to
 * Juno; resolve also marks the topic read, which mirrors like any mark.
 * Every command returns the undo the engine computed (ADR 0010).
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { AllTopicsStatus, ConversationKind, RowTag, TopicKind } from '@juno/domain'
import { NotFound, NotSignedIn, Offline, RateLimited, Rejected } from '../errors'
import { liveListRoute, liveValueRoute, RowFields } from '../live'
import { ChannelRef, Person } from '../refs'
import { AutomatedPlace, AutomatedRestore, SavedView } from '../views'

// The vocabulary is `@juno/domain`'s. It is re-exported so a renderer package
// that may not import domain still names the same literals.
export { ConversationKind, RowTag, TopicKind }
/** The status a sidebar row shows. `ignored` never reaches a row. */
export const TopicStatus = AllTopicsStatus
export type TopicStatus = typeof TopicStatus.Type

export const TitleSource = Schema.Literals(['manual', 'ai', 'fallback', 'channel'])
export type TitleSource = typeof TitleSource.Type

/** The sidebar holds at most this many rows (performance 3.2). The engine caps `range.limit` here; the renderer asks for it. */
export const SIDEBAR_WINDOW = 300

export const SidebarSection = Schema.Literals(['pinned', 'recent'])
export type SidebarSection = typeof SidebarSection.Type

const { partnerId: _partnerId, memberIds: _memberIds, ...channelFields } = ChannelRef.fields

/** Where a topic lives, with everything the tile and line three need: a `ChannelRef` with the DM partner and group members joined in. */
export const RowChannel = Schema.Struct({
  ...channelFields,
  /** The other person in a DM, for the tile. */
  partner: Schema.optionalKey(Person),
  /** A group DM's other members, at most three, for the tile. */
  members: Schema.optionalKey(Schema.Array(Person)),
})
export type RowChannel = typeof RowChannel.Type

/** The row's preview. The view joins them as "Sender: text", or shows the one that is not empty. */
export const TopicPreview = Schema.Struct({
  /** "You" for own messages, a first name or a bot's name otherwise, and empty for the other side of a one-to-one DM (`previewSender`). */
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
  /** The title is the root's first words (no AI title yet): raw message text, so privacy mode blurs it. */
  titleSensitive: Schema.optionalKey(Schema.Boolean),
  preview: TopicPreview,
  messageCount: Schema.Int,
  unreadCount: Schema.Int,
  /** False when the count is a lower bound and the row should show a dot. */
  unreadExact: Schema.Boolean,
  mentionsMe: Schema.Boolean,
  tags: Schema.Array(RowTag),
  pinned: Schema.Boolean,
  /** Resolved and pinned: quieter, with a check. */
  resolved: Schema.Boolean,
  /**
   * Slack's follow flag for a thread (true means Slack lists it as followed),
   * which `topics.subscribe` and `topics.unsubscribe` change. Always false for
   * Main, which has no follow.
   */
  subscribed: Schema.Boolean,
  /** Main rows: threads started in the channel since Main was last read ("2 new threads"). 0 for a thread, and for a Main never read. */
  newThreads: Schema.Int,
  /** People talking in the unread messages beyond the four the row names, for the stack's "+N". Absent when none. */
  moreParticipants: Schema.optionalKey(Schema.Int),
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
  /**
   * The senders of the topic's latest unread messages (at most the last 15),
   * most recent first, at most four, never you. Empty when the topic is read
   * and in DMs.
   */
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
  /** The ids of `TopicRow.participants`: unread senders, most recent first, at most four. */
  participantIds: Schema.Array(Schema.String),
})
export type TopicListRow = typeof TopicListRow.Type

export const KindFilter = Schema.Literals(['all', 'channels', 'dms'])
export type KindFilter = typeof KindFilter.Type

/** The quick filters and the scope chip (spec section 5). */
export const TopicListFilter = {
  kind: KindFilter,
  unreadOnly: Schema.Boolean,
  /** Narrowed to one channel from Browse or ⌘K. It wins over `view`, and shows the channel even when a view keeps it out of All. */
  scope: Schema.optionalKey(Schema.String),
  /**
   * A sidebar view's id: only its conversations, by the same rules. `kind`
   * is ignored. Without one, conversations a view keeps out of All are
   * left out.
   */
  view: Schema.optionalKey(Schema.String),
}

/** The sidebar list. Window of 300 rows, pinned first, then recent by latest activity. Rows name their channel and people; both are in `refs`. */
export const topicsList = liveListRoute('topics.list', { row: TopicListRow, payload: TopicListFilter })

export const TopicCounts = Schema.Struct({
  /** Unread topics the sidebar would show, per group, within the scope. */
  channelsUnread: Schema.Int,
  dmsUnread: Schema.Int,
  /** The views with a topic that has an unread mention of the user, for their dots. Plain unread does not count. */
  viewMentions: Schema.Array(Schema.String),
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
/**
 * Overlay columns as stored, for an undo: a present key sets the column,
 * `null` clears it. Only the engine builds one.
 */
export const OverlayPatch = Schema.Struct({
  manualTitle: Schema.optionalKey(Schema.NullOr(Schema.String)),
  resolvedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  resolvedActivityTs: Schema.optionalKey(Schema.NullOr(Schema.String)),
  reopenedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  pinnedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  settledDismissedTs: Schema.optionalKey(Schema.NullOr(Schema.String)),
  unfollowKeptTs: Schema.optionalKey(Schema.NullOr(Schema.String)),
  ignoreKeptTs: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
export type OverlayPatch = typeof OverlayPatch.Type

const restorePayload = {
  id: Schema.String,
  overlay: OverlayPatch,
  /** Also mark the topic unread from this message, as before a resolve or a mark read. */
  unreadFrom: Schema.optionalKey(Schema.String),
}

/** What a Notify me choice applies to: a thread topic id, a channel or DM id, or a user id. */
export const NotifyTargetSchema = Schema.Struct({ kind: Schema.Literals(['thread', 'channel', 'person']), id: Schema.String })
export type NotifyTargetView = typeof NotifyTargetSchema.Type
export const NotifyChoiceSchema = Schema.Literals(['always', 'auto', 'never'])

/**
 * A topic's stored drawing as `art.restore` writes it back: the `topic_art`
 * row, less the hash derived from the recipe.
 */
export const StoredArt = Schema.Struct({
  recipe: Schema.String,
  inputHash: Schema.String,
  model: Schema.String,
  status: Schema.String,
  hue: Schema.String,
  titleSource: Schema.String,
  source: Schema.String,
  createdAt: Schema.String,
})
export type StoredArt = typeof StoredArt.Type

/** The undo of a redraw: the drawing before it, or `null` when the topic had none. */
export const artRestorePayload = { id: Schema.String, previous: Schema.NullOr(StoredArt) }

/** A `follow_ups` row's marks as stored: when it was marked done, and the newest match the user said was not it. */
export const FollowUpRestore = Schema.Struct({
  topicId: Schema.String,
  messageTs: Schema.String,
  doneAt: Schema.NullOr(Schema.String),
  matchKeptTs: Schema.NullOr(Schema.String),
})

/** A topic's draft as stored. */
export const DraftRestore = Schema.Struct({
  topicId: Schema.String,
  text: Schema.String,
  updatedAt: Schema.String,
  keptAt: Schema.NullOr(Schema.String),
})

export const UndoCommand = Schema.Union([
  Schema.TaggedStruct('topics.restore', restorePayload),
  Schema.TaggedStruct('channels.ignore', { channel: Schema.String }),
  Schema.TaggedStruct('channels.unignore', { channel: Schema.String }),
  Schema.TaggedStruct('topics.subscribe', { id: Schema.String }),
  Schema.TaggedStruct('topics.unsubscribe', { id: Schema.String }),
  Schema.TaggedStruct('reads.markRead', { id: Schema.String, upTo: Schema.optionalKey(Schema.String) }),
  Schema.TaggedStruct('reads.markUnread', { id: Schema.String, from: Schema.optionalKey(Schema.String) }),
  Schema.TaggedStruct('notifications.setLevel', { target: NotifyTargetSchema, choice: NotifyChoiceSchema }),
  // Several resolves undone together (Home's Resolve all): `topics.restore` for each.
  Schema.TaggedStruct('topics.restoreAll', { restores: Schema.Array(Schema.Struct(restorePayload)) }),
  Schema.TaggedStruct('art.restore', artRestorePayload),
  // A deleted view, put back whole; and a conversation added to or removed from a view.
  Schema.TaggedStruct('views.restore', { view: SavedView }),
  Schema.TaggedStruct('views.addChannel', { id: Schema.String, channel: Schema.String }),
  Schema.TaggedStruct('views.removeChannel', { id: Schema.String, channel: Schema.String }),
  // An answer about the Automated view, put back as it was.
  Schema.TaggedStruct('views.sortChannel', { channel: Schema.String, to: AutomatedPlace, restore: Schema.optionalKey(AutomatedRestore) }),
  // A follow-up or a draft from Home's reviews, put back as stored.
  Schema.TaggedStruct('followUps.restore', FollowUpRestore.fields),
  Schema.TaggedStruct('drafts.restore', DraftRestore.fields),
  // A channel's rename and member changes, put back (`channels.edit` with the old name and the opposite changes).
  Schema.TaggedStruct('channels.edit', { channel: Schema.String, name: Schema.optionalKey(Schema.String), add: Schema.Array(Schema.String), remove: Schema.Array(Schema.String) }),
])
export type UndoCommand = typeof UndoCommand.Type

/** What a command returns: the undo computed from the state before the change, when there is one. */
export const CommandResult = Schema.Struct({ undo: Schema.optionalKey(UndoCommand) })
export type CommandResult = typeof CommandResult.Type

/**
 * Why a subscribe or unsubscribe may not have stuck. When one of these
 * arrives the thread shows what Slack said when asked afterwards; if Slack
 * could not be asked, it keeps the change until Slack answers, since the call
 * may have reached Slack. `NotFound` is a topic id the store does not know,
 * or a Main, which has no follow. The others are Slack's answer to the
 * mirror call.
 */
export const SubscribeError = Schema.Union([NotSignedIn, NotFound, Rejected, RateLimited, Offline])
export type SubscribeError = typeof SubscribeError.Type

const topicPayload = { id: Schema.String }

/**
 * Follows a thread in Slack ("Get notified about new replies") and shows it
 * in the sidebar. Returns an undo when something changed. A Main is `NotFound`.
 */
export const topicsSubscribe = Rpc.make('topics.subscribe', { payload: topicPayload, success: CommandResult, error: SubscribeError })

/** Unfollows a thread in Slack. Returns an undo that subscribes again. A Main is `NotFound`. */
export const topicsUnsubscribe = Rpc.make('topics.unsubscribe', { payload: topicPayload, success: CommandResult, error: SubscribeError })

/** Why a topic action did not happen: no workspace is open, or the id is not a topic the store knows (or the action does not apply to it). */
export const TopicActionError = Schema.Union([NotSignedIn, NotFound])
export type TopicActionError = typeof TopicActionError.Type

const action = <Tag extends string, P extends Schema.Struct.Fields>(tag: Tag, payload: P) =>
  Rpc.make(tag, { payload, success: CommandResult, error: TopicActionError })

/**
 * Resolves a topic: it leaves Recent until a new message reopens it (a
 * pinned one stays in Pinned with a check), and it is marked read. It
 * never unfollows. The undo puts back the resolve state, the Reopened tag
 * and the unread messages together.
 */
export const topicsResolve = action('topics.resolve', topicPayload)

/**
 * Keep open on Tidy up's review: Juno stops suggesting the topic until it
 * has new activity. Nothing changes in Slack. The undo suggests it again.
 */
export const topicsKeepOpen = action('topics.keepOpen', topicPayload)

/** Home's suggestions that a review can say no to (`docs/design/settled-suggestions/`), besides Tidy up's Keep open. */
export const KeptSuggestion = Schema.Literals(['unfollow', 'ignore'])
export type KeptSuggestion = typeof KeptSuggestion.Type

/**
 * Keep following (a thread) or Keep showing (a channel, by its Main's id)
 * on Home's Unfollow or Ignore review: Juno stops suggesting it until the
 * rule's wait has passed again from now. Nothing changes in Slack. The undo
 * suggests it again.
 */
export const topicsKeepSuggested = action('topics.keepSuggested', { id: Schema.String, suggestion: KeptSuggestion })

/** Reopens a resolved topic. The undo resolves it again as it was. */
export const topicsReopen = action('topics.reopen', topicPayload)

/** Pins a topic: it shows in Pinned whatever its status, unless its channel is ignored. */
export const topicsPin = action('topics.pin', topicPayload)

export const topicsUnpin = action('topics.unpin', topicPayload)

/**
 * Renames a thread. An empty title, or the AI title, clears the manual
 * title (architecture 4.4). Main has no title of its own: `NotFound`.
 */
export const topicsRename = action('topics.rename', { id: Schema.String, title: Schema.String })

/** Puts overlay columns back, and the unread messages with `unreadFrom`: the undo of the actions above. */
export const topicsRestore = action('topics.restore', restorePayload)

/**
 * Ignores a channel in Juno: its topics are hidden everywhere and do not
 * notify, except for a mention of the user by name or of a group they are
 * in, which notifies and shows on Home. Nothing changes in Slack. A DM
 * cannot be ignored: `NotFound`.
 */
export const channelsIgnore = action('channels.ignore', { channel: Schema.String })

export const channelsUnignore = action('channels.unignore', { channel: Schema.String })

/** A channel Settings › Ignored can add: one you are in, not archived and not ignored. */
export const IgnorableChannel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(['public', 'private']),
})
export type IgnorableChannel = typeof IgnorableChannel.Type
export const IGNORABLE_LIMIT = 2000

/** One ignored channel on Settings › Ignored (inventory 14). `hidden` counts the messages since it was ignored, at most `IGNORED_HIDDEN_CAP`. */
export const IgnoredChannel = Schema.Struct({
  ...IgnorableChannel.fields,
  hidden: Schema.Int,
})
export type IgnoredChannel = typeof IgnoredChannel.Type
export const IGNORED_HIDDEN_CAP = 1000

/** The ignore list, newest first. */
export const channelsIgnored = liveValueRoute('channels.ignored', { value: Schema.Array(IgnoredChannel) })

/** The channels the ignore list's add row offers, by name, at most `IGNORABLE_LIMIT`. */
export const channelsIgnorable = liveValueRoute('channels.ignorable', { value: Schema.Array(IgnorableChannel) })

export const TopicsRoutes = RpcGroup.make(
  topicsList,
  topicsCounts,
  topicsSubscribe,
  topicsUnsubscribe,
  topicsResolve,
  topicsKeepOpen,
  topicsKeepSuggested,
  topicsReopen,
  topicsPin,
  topicsUnpin,
  topicsRename,
  topicsRestore,
  channelsIgnore,
  channelsUnignore,
  channelsIgnored,
  channelsIgnorable,
)
