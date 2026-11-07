/**
 * The sidebar's Reactions view (SPEC 5, "Reactions"): the user's messages
 * that someone else reacted to lately, newest first by when the latest of
 * those reactions came.
 *
 * `reactions.feed` reads the store. While it is subscribed the engine reads
 * Slack's `activity.feed` once, again each time the socket connects, and
 * fetches the messages of rows the store lacks; the rows update as those land
 * and as reactions come and go on the socket. Nothing polls.
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
  /** When the latest reaction by someone else came, epoch milliseconds. */
  at: Schema.Number,
  /** Who reacted, never you: the latest first, at most two. */
  reactors: Schema.Array(Person),
  /** The other people who reacted, beyond `reactors`. */
  moreReactors: Schema.Int,
  /** Line one's names: the reactors' first names (a last initial tells two apart), then "+N" for the rest: "Maya, Sam +2". */
  who: Schema.String,
  /** Their emoji, the latest first, at most three. */
  emoji: Schema.Array(ReactionRowEmoji),
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

export const reactionsFeed = liveValueRoute('reactions.feed', { value: Schema.Array(ReactionRow) })

export const ReactionFeedRoutes = RpcGroup.make(reactionsFeed)
