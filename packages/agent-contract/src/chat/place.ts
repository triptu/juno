/**
 * Where things point. These are the small shapes cards and bubbles share:
 * a Slack place for the context pill, a topic link, and what "Open" opens.
 *
 * They repeat a few names from `@juno/domain` on purpose: this package is
 * portable and may not depend on Juno's Slack packages (`check-deps`).
 */
import { Schema } from 'effect'
import { ChatMessageId } from './ids'

/** The context tint of a Slack place (SPEC §16): public, private or DM. */
export const PlaceTint = Schema.Literals(['public', 'private', 'dm'])
export type PlaceTint = typeof PlaceTint.Type

/** A Slack channel or DM as a context pill shows it. */
export const Place = Schema.Struct({
  channelId: Schema.String,
  /** "eng", "Maya Chen", "Maya, Leo": the pill text without "#". */
  name: Schema.String,
  /** "Public channel", "Private channel", "Direct message", "Group message". */
  kindLabel: Schema.String,
  tint: PlaceTint,
})
export type Place = typeof Place.Type

/** A topic the chat can open: a thread or a channel's Main. */
export const TopicLink = Schema.Struct({
  topicId: Schema.String,
  /** The topic title, or "#eng · Main" for a Main stream (SPEC §17). */
  title: Schema.String,
  /** The place line under the title: "#eng", "Maya Chen". */
  where: Schema.String,
  tint: PlaceTint,
})
export type TopicLink = typeof TopicLink.Type

/** What an "Open" link opens. */
export const OpenTarget = Schema.Union([
  Schema.TaggedStruct('topic', { topicId: Schema.String }),
  /** Scroll the chat to one of its own messages (a recall citation). */
  Schema.TaggedStruct('chatMessage', { messageId: ChatMessageId }),
  /** A PR, a Notion page, a T3 Code thread: opened outside Juno. */
  Schema.TaggedStruct('url', { url: Schema.String, label: Schema.String }),
  Schema.TaggedStruct('page', { page: Schema.Literals(['scheduled', 'remembers', 'memory', 'activity', 'connections', 'settings']) }),
])
export type OpenTarget = typeof OpenTarget.Type
