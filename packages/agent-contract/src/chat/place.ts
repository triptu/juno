/**
 * Where things point. These are the small shapes cards and bubbles share:
 * a Slack place for the context pill, a topic link, and what "Open" opens.
 *
 * They repeat a few names from `@juno/domain` on purpose: this package is
 * portable and may not depend on Juno's Slack packages (`check-deps`).
 */
import { Schema } from 'effect'
import { Place, PlaceTint } from '@juno/agent-cards/presentation'
export { Place, PlaceTint, JobRef, TopicLink, JunoPage, OpenTarget, OpenableUrl, isT3ThreadUrl } from '@juno/agent-cards/presentation'

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
