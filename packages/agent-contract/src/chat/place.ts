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
  /** The sender of the message the selection starts in, as the topic shows it ("Maya"). */
  sender: Schema.optionalKey(Schema.String),
  /** The Slack `ts` of the message the selection starts in. */
  ts: Schema.optionalKey(Schema.String),
  /** How many messages the selection spans, when more than one. */
  messages: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(1))),
})
export type Selection = typeof Selection.Type

/** About as many characters as the chip shows of a selection. */
const SNIPPET_CHARS = 28
/** The tooltip shows the selection up to this length; Juno still gets all of it. */
const TOOLTIP_CHARS = 400

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Cut at a word near `max` characters, with an ellipsis. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const space = text.lastIndexOf(' ', max)
  const at = space > max / 2 ? space : max
  // Never between the two halves of an emoji.
  const end = /[\uD800-\uDBFF]/.test(text[at - 1] ?? '') ? at - 1 : at
  return `${text.slice(0, end).replace(/[\s.,;:!?…-]+$/u, '')}…`
}

/** "Maya" for one message, "3 messages" for several: who or how much the selection chip names. */
export function selectionSource(selection: Selection): string | undefined {
  return selection.messages !== undefined ? `${selection.messages} messages` : selection.sender
}

/** "“the deploy failed on…”": the start of the selection, quoted, on one line, cut at a word. The chip shows "Maya: " before it. */
export function selectionSnippet(selection: Selection): string {
  return `“${cut(oneLine(selection.text), SNIPPET_CHARS)}”`
}

/** "Maya: the deploy failed on staging…", the chip's tooltip: the whole selection, up to 400 characters. */
export function selectionTooltip(selection: Selection): string {
  const text = cut(oneLine(selection.text), TOOLTIP_CHARS)
  const source = selectionSource(selection)
  return source === undefined ? text : `${source}: ${text}`
}

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
