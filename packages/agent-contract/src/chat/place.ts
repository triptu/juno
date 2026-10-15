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

/** The owner's text selection in a topic, sent as a quote (SPEC §7, Juno panel). */
export const MAX_SELECTION_CHARS = 4_000
export const Selection = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(MAX_SELECTION_CHARS)),
  /** The sender of the message the selection starts in. */
  sender: Schema.optionalKey(Schema.String),
})
export type Selection = typeof Selection.Type

/**
 * What a message is about, sent with it (SPEC §7, plan v3 §19.3).
 *
 * - `topic`: sent from the Juno panel beside a topic. A reference, not the
 *   messages: Juno reads the topic itself, so the run counts as having read
 *   Slack. `visible` is the first and last message on screen, `newFrom` the
 *   first message under the "new" divider, both as Slack `ts`.
 * - `person` and `channel`: from Ask Juno in a menu. A name and an id only,
 *   so the run stays clean until Juno reads.
 */
export const SendContext = Schema.Union([
  Schema.TaggedStruct('topic', {
    topicId: Schema.String,
    /** The topic title, or "#eng · Main" for a Main stream. */
    title: Schema.String,
    place: Place,
    kind: Schema.Literals(['thread', 'main']),
    visible: Schema.optionalKey(Schema.Struct({ from: Schema.String, to: Schema.String })),
    newFrom: Schema.optionalKey(Schema.String),
    selection: Schema.optionalKey(Selection),
  }),
  Schema.TaggedStruct('person', { userId: Schema.String, name: Schema.String }),
  Schema.TaggedStruct('channel', { place: Place }),
])
export type SendContext = typeof SendContext.Type

/** The "About …" line over an owner bubble: what the message was about, by name. */
export const About = Schema.Union([
  Schema.TaggedStruct('topic', { topicId: Schema.String, title: Schema.String }),
  Schema.TaggedStruct('person', { userId: Schema.String, name: Schema.String }),
  Schema.TaggedStruct('channel', { channelId: Schema.String, name: Schema.String, tint: PlaceTint }),
])
export type About = typeof About.Type

export function aboutOf(context: SendContext): About {
  switch (context._tag) {
    case 'topic':
      return { _tag: 'topic', topicId: context.topicId, title: context.title }
    case 'person':
      return { _tag: 'person', userId: context.userId, name: context.name }
    case 'channel':
      return { _tag: 'channel', channelId: context.place.channelId, name: context.place.name, tint: context.place.tint }
  }
}

/** "Postgres 16 migration plan", "Maya Chen", "#eng". The About line and chip put "About " before it. */
export function aboutLabel(about: About): string {
  switch (about._tag) {
    case 'topic':
      return about.title
    case 'person':
      return about.name
    case 'channel':
      return about.tint === 'dm' ? about.name : `#${about.name}`
  }
}

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
 * custom scheme in a spoofed tool result, is refused at decode time. The fixed
 * T3 thread link is the only permitted custom scheme.
 */
export const isT3ThreadUrl = (url: string): boolean => /^t3-thread:\/\/v1\/[a-zA-Z0-9_-]+$/.test(url)
export const isOpenableUrl = (url: string): boolean => OPENABLE.test(url) || isT3ThreadUrl(url)

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
  /** A Slack message (a source): the topic that holds it, its thread or Main, opened at the message, which flashes. */
  Schema.TaggedStruct('message', { channelId: Schema.String, ts: Schema.String }),
  /** A PR, a Notion page, a T3 Code thread: opened outside Juno. */
  Schema.TaggedStruct('url', { url: OpenableUrl, label: Schema.String }),
  Schema.TaggedStruct('page', { page: JunoPage }),
])
export type OpenTarget = typeof OpenTarget.Type
