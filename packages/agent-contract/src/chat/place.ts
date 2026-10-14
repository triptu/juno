/**
 * Where things point. These are the small shapes cards and bubbles share:
 * a Slack place for the context pill, a topic link, and what "Open" opens.
 *
 * They repeat a few names from `@juno/domain` on purpose: this package is
 * portable and may not depend on Juno's Slack packages (`check-deps`).
 */
import { Schema } from 'effect'
import { ChatMessageId, JobId } from './ids'

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

/** A job as a label or a pill names it. */
export const JobRef = Schema.Struct({ jobId: JobId, title: Schema.String })
export type JobRef = typeof JobRef.Type

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

/** `https:` on any host, or `http:` on loopback with an optional port. */
const OPENABLE = /^(?:https:\/\/[^\s/?#]+|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)(?:[/?#]|$)/i

/**
 * Whether an "Open" link may leave Juno. Only `https:` anywhere, or `http:`
 * on loopback (a local T3 Code thread). Anything else, such as `file:` or a
 * custom scheme in a spoofed tool result, is refused at decode time.
 */
export const isOpenableUrl = (url: string): boolean => OPENABLE.test(url)

export const OpenableUrl = Schema.String.check(
  Schema.makeFilter((url: string) => isOpenableUrl(url) || 'an https: URL, or http: on loopback', {
    title: 'OpenableUrl',
  }),
)
export type OpenableUrl = typeof OpenableUrl.Type

/** The pages behind the Juno header menu, plus the recovery review. */
export const JunoPage = Schema.Literals(['scheduled', 'remembers', 'memory', 'activity', 'connections', 'settings', 'review'])
export type JunoPage = typeof JunoPage.Type

/** What an "Open" link opens. */
export const OpenTarget = Schema.Union([
  Schema.TaggedStruct('topic', { topicId: Schema.String }),
  /** Scroll the chat to one of its own messages (a recall citation). */
  Schema.TaggedStruct('chatMessage', { messageId: ChatMessageId }),
  /** A PR, a Notion page, a T3 Code thread: opened outside Juno. */
  Schema.TaggedStruct('url', { url: OpenableUrl, label: Schema.String }),
  Schema.TaggedStruct('page', { page: JunoPage }),
])
export type OpenTarget = typeof OpenTarget.Type
