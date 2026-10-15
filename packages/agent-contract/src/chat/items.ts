/**
 * The things in the chat list, as the virtualised list renders them. One
 * item is one row. The container derives these from the archive and the
 * run state; the views read them and call back with ids.
 *
 * The chat is not a transcript. Juno's bubbles are only the text the model
 * marked for the owner; its other text never shows. Rows that carry
 * content: an owner bubble, a Juno bubble, a card, a run's ending line,
 * the one status bubble (typing dots, only while a run is active), a note
 * line ("Remembered · Undo"), and a group label over a proactive group. The
 * rest are separators.
 */
import { Schema } from 'effect'
import { Card } from './cards'
import { BubbleId, CardId, ChatMessageId, OpId, RunId, ScheduleId } from './ids'
import { About, JobRef } from './place'

/** Exactly one emoji, any emoji. A reaction is content, so it shows as the emoji itself. */
export const isEmoji = (text: string): boolean => {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
  return graphemes.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(text)
}
export const Emoji = Schema.String.check(Schema.makeFilter((text: string) => isEmoji(text) || 'one emoji', { title: 'Emoji' }))
export type Emoji = typeof Emoji.Type

/** The thumbs up. From the owner it is only recorded: it starts no run and Juno never sees it. */
export const THUMBS_UP = '👍'

/**
 * A reaction on a bubble or a card, by either side, at most one per side
 * per item. A reaction is never a click: it approves nothing and pins
 * nothing.
 */
export const Reaction = Schema.Struct({ by: Schema.Literals(['owner', 'juno']), emoji: Emoji })
export type Reaction = typeof Reaction.Type

/** What a reply points at. The owner replies to a Juno bubble or card; Juno replies to an owner message. */
export const ReplyTarget = Schema.Union([
  Schema.TaggedStruct('bubble', { id: BubbleId }),
  Schema.TaggedStruct('card', { id: CardId }),
  Schema.TaggedStruct('owner', { opId: OpId }),
])
export type ReplyTarget = typeof ReplyTarget.Type

/**
 * The one-line quote above a reply. `preview` is computed by the agent (the
 * first line of a bubble or message, or the card's kind and place). A click
 * scrolls to the target. `removed` when the target was removed: the quote
 * reads "Removed".
 */
export const Quote = Schema.Struct({
  target: ReplyTarget,
  preview: Schema.String,
  removed: Schema.optionalKey(Schema.Literal(true)),
})
export type Quote = typeof Quote.Type

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
 *   sending ─▶ sent | waiting ─▶ sent
 *   sending ─▶ failed
 *
 * `sending` lasts until the inbox commit (plan v3 §3), so it is rarely
 * seen. The inbox is local, so a send is accepted offline, while paused and
 * in recovery; it then `waits`, and runs once the network, Resume or the
 * review lets it. A send while Juno is working is `sent` like any other:
 * it joins the run at its next step and Juno's reply acknowledges it, as in
 * a text chat, so the bubble shows no extra state. `failed` has two causes with different copy: the inbox write
 * failed ("Not delivered · Try again", which resubmits the same op), or the
 * text was over 64 KB and was refused locally.
 */
export const Delivery = Schema.Union([
  Schema.TaggedStruct('sending', {}),
  Schema.TaggedStruct('sent', {}),
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
  /** The owner replied to a Juno bubble or card. */
  replyTo: Schema.optionalKey(Quote),
  /** Sent from the Juno panel or with an About chip: the "About …" line over the bubble. */
  about: Schema.optionalKey(About),
  /** Juno may react instead of replying. */
  reactions: Schema.Array(Reaction),
  group: GroupPosition,
})
export type OwnerMessageItem = typeof OwnerMessageItem.Type

/**
 * Juno's text is plain. The mark-up is a recall citation, which links to the
 * day it quotes and scrolls the chat there ("On 12 Mar you said …"), and a
 * source (plan v3 §19.1): words Juno took from a Slack message it read in
 * that reply, which open the topic at that message. `place` is the channel
 * as the owner sees it ("#eng"); the view adds the message's time for the
 * tooltip, from `ts`.
 */
export const JunoInline = Schema.Union([
  Schema.TaggedStruct('text', { text: Schema.String }),
  Schema.TaggedStruct('cite', { text: Schema.String, messageId: ChatMessageId }),
  Schema.TaggedStruct('source', { text: Schema.String, channelId: Schema.String, ts: Schema.String, place: Schema.String }),
])
export type JunoInline = typeof JunoInline.Type

/**
 * How a run ended. `complete` is the normal case and shows nothing. Every
 * other variant is one fixed line from `chatCopy.ending` (an `ending`
 * row); the model never writes it.
 *
 * - `interrupted`: the process died or the request was refused at the
 *   provider guard. `retry` is the owner op to resubmit, when the run had
 *   one; wake and report runs have none and show no Try again.
 * - `blocked`: no provider call was made. `tooLarge` is plan v3 §5.2;
 *   `budget` is the daily cap (§5.4), and a `budget` card follows.
 * - `failed`: the provider did not answer, with the reason that picks the
 *   copy. `retry` as for `interrupted`.
 *
 * A run can end before its first bubble; then the line is all that shows.
 */
export const Ending = Schema.Union([
  Schema.TaggedStruct('complete', {}),
  Schema.TaggedStruct('interrupted', { retry: Schema.optionalKey(OpId) }),
  Schema.TaggedStruct('blocked', { reason: Schema.Literals(['tooLarge', 'budget']) }),
  Schema.TaggedStruct('failed', {
    reason: Schema.Literals(['provider', 'keyRejected', 'codexSignedOut', 'offline']),
    retry: Schema.optionalKey(OpId),
  }),
])
export type Ending = typeof Ending.Type

/**
 * One Juno bubble. It arrives whole, when the model closes it; nothing
 * streams into it. A run can post any number of bubbles, of any length:
 * the model decides.
 */
export const JunoBubbleItem = Schema.TaggedStruct('juno', {
  id: BubbleId,
  runId: RunId,
  body: Schema.Array(JunoInline),
  at: Schema.Number,
  origin: Origin,
  /** Juno replied to one owner message. */
  replyTo: Schema.optionalKey(Quote),
  reactions: Schema.Array(Reaction),
  group: GroupPosition,
  /** Not yet seen by the owner: the Juno nav count counts these. */
  unread: Schema.Boolean,
})
export type JunoBubbleItem = typeof JunoBubbleItem.Type

/** A card under Juno's bubbles. The owner can react to it or reply to it; neither is a click. */
export const CardItem = Schema.TaggedStruct('card', {
  runId: RunId,
  card: Card,
  reactions: Schema.Array(Reaction),
  unread: Schema.Boolean,
})
export type CardItem = typeof CardItem.Type

/** The fixed line of a run that did not end `complete`. */
export const EndingItem = Schema.TaggedStruct('ending', { runId: RunId, ending: Ending })
export type EndingItem = typeof EndingItem.Type

/**
 * The one status bubble: typing dots while a run is active, always the last
 * item. It sits between bubbles: each bubble takes its place when it
 * arrives, and it shows again below while the run goes on. A tool call
 * gives it a line that names real things ("Reading 3 topics"). It has no
 * Stop: to change course the owner sends another message.
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
 * The 11 px label above a proactive group: "Scheduled · Daily
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

export const ChatItem = Schema.Union([OwnerMessageItem, JunoBubbleItem, CardItem, EndingItem, StatusItem, NoteItem, GroupLabelItem, DayItem, NewDividerItem])
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
