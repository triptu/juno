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
import { ChatMessageId, OpId, RunId, ScheduleId } from './ids'
import { JobRef } from './place'

/**
 * Where a bubble sits in its group. Groups are formed by sender within
 * 2 minutes and the same origin; the tail and the Juno mark go on `last`
 * and `single`. Precomputed so a row renders without reading its
 * neighbours.
 */
export const GroupPosition = Schema.Literals(['single', 'first', 'middle', 'last'])
export type GroupPosition = typeof GroupPosition.Type

/**
 * What started the run a Juno message came from. A different origin always
 * starts a new group. Reports that arrive together are one message, so a
 * `job` origin names every job it combines; the label reads "T3 Code ·
 * Fix the sidebar flake" for one and "T3 Code · 2 jobs" for more.
 */
export const Origin = Schema.Union([
  /** A reply to the owner. */
  Schema.TaggedStruct('owner', {}),
  /** A schedule woke Juno. */
  Schema.TaggedStruct('schedule', { scheduleId: ScheduleId, name: Schema.String }),
  /** One or more background jobs reported. */
  Schema.TaggedStruct('job', { jobs: Schema.Array(JobRef).check(Schema.isMinLength(1)) }),
])
export type Origin = typeof Origin.Type

/**
 * An owner send's delivery, as the line under the bubble:
 *
 *   sending ─▶ sent | queued ─▶ sent | waiting ─▶ sent
 *   sending ─▶ failed
 *
 * `sending` lasts until the inbox commit (plan v3 §3), so it is rarely
 * seen. The inbox is local, so a send is accepted offline, while paused and
 * in recovery; it then `waits`, and runs once the network, Resume or the
 * review lets it. `queued` is a steer into a busy run; the view shows
 * "Queued" only after 500 ms so a steer read within a tool round never
 * flickers. `failed` has two causes with different copy: the inbox write
 * failed ("Not delivered · Try again", which resubmits the same op), or the
 * text was over 64 KB and was refused locally.
 */
export const Delivery = Schema.Union([
  Schema.TaggedStruct('sending', {}),
  Schema.TaggedStruct('sent', {}),
  Schema.TaggedStruct('queued', { since: Schema.Number }),
  Schema.TaggedStruct('waiting', { for: Schema.Literals(['network', 'resume', 'review']) }),
  Schema.TaggedStruct('failed', { reason: Schema.Literals(['notDelivered', 'tooLong']) }),
])
export type Delivery = typeof Delivery.Type

/**
 * The owner's bubble. `opId` is the row key: it exists from the first
 * frame, before the inbox commit and before the archive projects the
 * message. `id` arrives with the archive row and stays optional until then,
 * so a row never remounts when it is committed.
 */
export const OwnerMessageItem = Schema.TaggedStruct('owner', {
  opId: OpId,
  id: Schema.optionalKey(ChatMessageId),
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
 * How a Juno message ended. `complete` is the normal case. Every other
 * variant adds one fixed line under the bubble from `chatCopy.ending`; the
 * model never writes it, because an aborted or failed run writes nothing.
 *
 * - `stopped`: the owner pressed Stop. "Stopped. Juno won't start anything new for this reply."
 *   Work handed off before Stop may still land; its card shows that.
 * - `interrupted`: the process died or the request was refused at the
 *   provider guard. `retry` is the owner op to resubmit, when the run had
 *   one; wake and report runs have none and show no Try again.
 * - `blocked`: no provider call was made. `tooLarge` is plan v3 §5.2;
 *   `budget` is the daily cap (§5.4), and a `budget` card follows.
 * - `failed`: the provider did not answer, with the reason that picks the
 *   copy. `retry` as for `interrupted`.
 *
 * A run can end before its first token. That Juno item has an empty `body`
 * and renders only the ending line, with no bubble.
 */
export const Ending = Schema.Union([
  Schema.TaggedStruct('complete', {}),
  Schema.TaggedStruct('stopped', {}),
  Schema.TaggedStruct('interrupted', { retry: Schema.optionalKey(OpId) }),
  Schema.TaggedStruct('blocked', { reason: Schema.Literals(['tooLarge', 'budget']) }),
  Schema.TaggedStruct('failed', {
    reason: Schema.Literals(['provider', 'keyRejected', 'codexSignedOut', 'offline']),
    retry: Schema.optionalKey(OpId),
  }),
])
export type Ending = typeof Ending.Type

export const JunoMessageItem = Schema.TaggedStruct('juno', {
  id: ChatMessageId,
  runId: RunId,
  /** Empty when the run ended before its first token: only the ending line shows. */
  body: Schema.Array(JunoInline),
  at: Schema.Number,
  origin: Origin,
  /**
   * The run is still active and this bubble takes its text. It stays true
   * through tool calls between tokens; the status bubble sits below it then.
   */
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
 * 2 s. On the first token it is replaced in place by a streaming Juno
 * bubble. If the run then calls tools, the status bubble reappears below
 * that bubble, and the next token clears it again: the text joins the same
 * bubble, so a run has one Juno bubble however many tool rounds it makes.
 * Stop aborts the run only, never a background job.
 */
export const StatusItem = Schema.TaggedStruct('status', {
  runId: RunId,
  text: Schema.optionalKey(Schema.String),
})
export type StatusItem = typeof StatusItem.Type

/**
 * A quiet line between bubbles, with fixed copy from `chatCopy.note`.
 * `remembered` follows a pin ("Remembered · Undo"); `removed` marks where a
 * message was redacted; `secretBlocked` says Juno stopped a tool call that
 * held a key or a token (plan v3 §10.1), in fixed words, never the model's.
 */
export const NoteItem = Schema.TaggedStruct('note', {
  id: ChatMessageId,
  kind: Schema.Literals(['remembered', 'removed', 'secretBlocked']),
  /** The pin's text for `remembered`, so Undo is informed. */
  text: Schema.optionalKey(Schema.String),
  /** Undo is open until the owner's next send or for 60 s, whichever is first. */
  undo: Schema.optionalKey(Schema.Literal(true)),
})
export type NoteItem = typeof NoteItem.Type

/**
 * The 11 px uppercase label above a proactive group: "Scheduled · Daily
 * catch-up", "T3 Code · Fix the sidebar flake". It carries "Why this?" and
 * one quiet action from the origin: "Pause schedule" for a schedule, "Mute
 * updates" for a job (milestone messages stop; the job runs on and stops
 * only from its Task card, plan v3 B5).
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

/**
 * The local Remove sheet, opened from a message's context menu. It is not a
 * card: it works in every state (paused, offline, AI off, recovery), and
 * the click is the owner's redaction (plan v3 §4.5). A `remove` card exists
 * only for removals Juno proposes.
 */
export const RemoveSheet = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({
      messageId: ChatMessageId,
      /** The first line, for the owner to recognise it. */
      preview: Schema.String,
      at: Schema.Number,
    }),
  ).check(Schema.isMinLength(1)),
  /** The next message is Juno's reply: offer "Also remove Juno's reply". */
  offerReply: Schema.optionalKey(ChatMessageId),
})
export type RemoveSheet = typeof RemoveSheet.Type
