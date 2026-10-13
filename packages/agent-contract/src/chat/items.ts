/**
 * The things in the chat list, as the virtualised list renders them. One
 * item is one row. The container derives these from the archive and the
 * run state; the views read them and call back with ids.
 *
 * Five kinds of row carry content: an owner bubble, a Juno bubble with its
 * cards, the one status bubble (only while a run is active), a note line
 * ("Remembered · Undo"), and a group label over a proactive group. The rest
 * are separators.
 */
import { Schema } from 'effect'
import { Card } from './cards'
import { ChatMessageId, JobId, OpId, RunId, ScheduleId } from './ids'

/**
 * Where a bubble sits in its group. Groups are formed by sender within
 * 2 minutes and the same origin; the tail and the Juno mark go on `last`
 * and `single`. Precomputed so a row renders without reading its
 * neighbours.
 */
export const GroupPosition = Schema.Literals(['single', 'first', 'middle', 'last'])
export type GroupPosition = typeof GroupPosition.Type

/** What started the run a Juno message came from. A different origin always starts a new group. */
export const Origin = Schema.Union([
  /** A reply to the owner. */
  Schema.TaggedStruct('owner', {}),
  /** A schedule woke Juno. */
  Schema.TaggedStruct('schedule', { scheduleId: ScheduleId, name: Schema.String }),
  /** A background job reported. */
  Schema.TaggedStruct('job', { jobId: JobId, title: Schema.String }),
])
export type Origin = typeof Origin.Type

/**
 * An owner send's delivery, as the line under the bubble:
 *
 *   sending ─▶ sent | queued ─▶ sent
 *   sending ─▶ failed
 *
 * `sending` lasts until the inbox commit (plan v3 §3), so it is rarely seen.
 * `queued` is a steer into a busy run; the view shows "Queued" only after
 * 500 ms so a steer read within a tool round never flickers. `failed` has
 * two causes with different copy: the write failed ("Not delivered · Try
 * again", which resubmits the same op), or the text was over 64 KB and was
 * refused locally.
 */
export const Delivery = Schema.Union([
  Schema.TaggedStruct('sending', {}),
  Schema.TaggedStruct('sent', {}),
  Schema.TaggedStruct('queued', { since: Schema.Number }),
  Schema.TaggedStruct('failed', { reason: Schema.Literals(['notDelivered', 'tooLong']) }),
])
export type Delivery = typeof Delivery.Type

export const OwnerMessageItem = Schema.TaggedStruct('owner', {
  id: ChatMessageId,
  opId: OpId,
  text: Schema.String,
  at: Schema.Number,
  delivery: Delivery,
  group: GroupPosition,
})
export type OwnerMessageItem = typeof OwnerMessageItem.Type

/**
 * Juno's text is plain: no markdown, no emoji. The only mark-up is a recall
 * citation, which links to the day it quotes and scrolls the chat there
 * ("On 12 Mar you said …").
 */
export const JunoInline = Schema.Union([
  Schema.TaggedStruct('text', { text: Schema.String }),
  Schema.TaggedStruct('cite', { text: Schema.String, messageId: ChatMessageId }),
])
export type JunoInline = typeof JunoInline.Type

/**
 * How a Juno message ended. `complete` is the normal case. The others add
 * one line under the bubble, in the copy of plan v3 §13.2: `stopped` says
 * what was kept (Juno writes that itself, in the text), `interrupted`
 * offers Try again for the owner message that started the run, and
 * `blocked` says the request could not fit.
 */
export const Ending = Schema.Union([
  Schema.TaggedStruct('complete', {}),
  Schema.TaggedStruct('stopped', {}),
  Schema.TaggedStruct('interrupted', { retry: OpId }),
  Schema.TaggedStruct('blocked', {}),
])
export type Ending = typeof Ending.Type

export const JunoMessageItem = Schema.TaggedStruct('juno', {
  id: ChatMessageId,
  runId: RunId,
  body: Schema.Array(JunoInline),
  at: Schema.Number,
  origin: Origin,
  /** Still receiving tokens: the status bubble became this bubble in place. */
  streaming: Schema.Boolean,
  ending: Ending,
  cards: Schema.Array(Card),
  group: GroupPosition,
  /** Not yet seen by the owner: the Juno nav count counts these. */
  unread: Schema.Boolean,
})
export type JunoMessageItem = typeof JunoMessageItem.Type

/**
 * The one status bubble. It exists only while a run is active and is always
 * the last item. Dots alone until the first tool call gives it text
 * ("Reading 3 topics"), which counts real things and changes at most every
 * 2 s. On the first token it is replaced by a streaming Juno bubble. Stop
 * aborts the run only, never a background job.
 */
export const StatusItem = Schema.TaggedStruct('status', {
  runId: RunId,
  text: Schema.optionalKey(Schema.String),
})
export type StatusItem = typeof StatusItem.Type

/**
 * A quiet line between bubbles. `remembered` follows a pin ("Remembered ·
 * Undo"); `removed` marks where a message was redacted.
 */
export const NoteItem = Schema.TaggedStruct('note', {
  id: ChatMessageId,
  kind: Schema.Literals(['remembered', 'removed']),
  /** The pin's text for `remembered`, so Undo is informed. */
  text: Schema.optionalKey(Schema.String),
  /** Undo is open for a while after a remember. */
  undo: Schema.optionalKey(Schema.Literal(true)),
})
export type NoteItem = typeof NoteItem.Type

/**
 * The 11 px uppercase label above a proactive group: "Scheduled · Daily
 * catch-up", "T3 Code · Fix the sidebar flake". It carries "Why this?" and
 * "Stop these"; the container answers them from the origin.
 */
export const GroupLabelItem = Schema.TaggedStruct('groupLabel', {
  id: Schema.String,
  origin: Origin,
  text: Schema.String,
})
export type GroupLabelItem = typeof GroupLabelItem.Type

/** A day separator: the start of the day in ms. The view writes "Today", "Yesterday", "Sat", "Oct 3". */
export const DayItem = Schema.TaggedStruct('day', { at: Schema.Number })
export type DayItem = typeof DayItem.Type

/** The "New" divider before the first unread Juno message. */
export const NewDividerItem = Schema.TaggedStruct('newDivider', { count: Schema.Int })
export type NewDividerItem = typeof NewDividerItem.Type

export const ChatItem = Schema.Union([OwnerMessageItem, JunoMessageItem, StatusItem, NoteItem, GroupLabelItem, DayItem, NewDividerItem])
export type ChatItem = typeof ChatItem.Type
