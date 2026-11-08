/**
 * The sidebar's Reactions view (SPEC 5, "Reactions"): the user's messages
 * that someone else reacted to lately, one row each as Slack's Activity
 * lists them, newest first by the headline reaction's time.
 *
 * `reactions.feed` reads the store, as every list does, so a view opened
 * again shows its rows at once. `reactions.watch` is the view being open:
 * while it is subscribed the engine reads Slack's `activity.feed` once,
 * again each time the socket connects, and reads the messages of rows the
 * store lacks; the rows update as those land and as reactions come and go
 * on the socket. Nothing polls.
 */
import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { liveValueRoute } from '../live'
import { Person } from '../refs'
import { RowChannel } from './topics'

/** Rows the view shows at most. */
export const REACTION_ROWS = 50

/** How far back the view looks. */
export const REACTION_DAYS = 14

/** One emoji on a reaction row: Slack's name, and the emoji as text or as an image. */
export const ReactionRowEmoji = Schema.Struct({
  name: Schema.String,
  unicode: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
})
export type ReactionRowEmoji = typeof ReactionRowEmoji.Type

export const ReactionRow = Schema.Struct({
  /** `channel:ts` of the message. */
  id: Schema.String,
  /** The topic that shows the message: its thread for a reply or a root with replies, else the conversation's Main. */
  topicId: Schema.String,
  ts: Schema.String,
  /** When the headline's reaction came (the feed entry's `feed_ts`, or the live event's time), epoch milliseconds. */
  at: Schema.Number,
  /** The headline's reactor, never you: the feed entry's, or the latest live reaction's. */
  reactor: Person,
  /** How many other people have any reaction on the message now, from the stored message. */
  others: Schema.Int,
  /** Line one's text: the reactor's first name (a last initial tells two apart), then "+N" when `others` is not 0: "Maya +2". */
  who: Schema.String,
  /** The headline's emoji. */
  emoji: ReactionRowEmoji,
  /** The message's first words, or a label for what it carries ("Image"). Message text: privacy mode blurs it. */
  preview: Schema.String,
  /** Where the message is. */
  channel: RowChannel,
  /** A reply's thread title, or the root's first words while the thread has no other title. */
  threadTitle: Schema.optionalKey(Schema.String),
  /** `threadTitle` is message text, so privacy mode blurs it. */
  threadTitleSensitive: Schema.optionalKey(Schema.Boolean),
})
export type ReactionRow = typeof ReactionRow.Type

/** The view's rows, from the store alone, like any list: subscribing asks Slack for nothing (`reactions.watch` does). */
export const reactionsFeed = liveValueRoute('reactions.feed', { value: Schema.Array(ReactionRow) })

/**
 * The view is open. While subscribed, the engine reads Slack's feed, now and each time the socket connects,
 * and reads the messages of rows the store lacks. Its one value says the subscription started; it carries
 * nothing else.
 */
export const reactionsWatch = liveValueRoute('reactions.watch', { value: Schema.Boolean })

export const ReactionFeedRoutes = RpcGroup.make(reactionsFeed, reactionsWatch)
