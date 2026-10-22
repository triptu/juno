/**
 * Where things point. These are the small shapes cards and bubbles share:
 * a Slack place for the context pill, a topic link, and what "Open" opens.
 *
 * They repeat a few names from `@juno/domain` on purpose: this package is
 * portable and may not depend on Juno's Slack packages (`check-deps`).
 */
import { Schema } from 'effect'
import { MAX_SELECTION_CHARS } from './text'
import { Place, PlaceTint } from '@juno/agent-cards/presentation'
export { Place, PlaceTint, JobRef, TopicLink, JunoPage, OpenTarget, OpenableUrl, isT3ThreadUrl } from '@juno/agent-cards/presentation'

/** The owner's text selection in a topic, sent as a quote (SPEC §7, Juno panel). */
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

/**
 * What a message is about, sent with it (SPEC §7, plan v3 §19.3).
 *
 * - `topic`: sent from the Juno panel beside a topic. A reference, not the
 *   messages: Juno reads the topic itself, so the run counts as having read
 *   Slack. `visible` is the first and last message on screen, `newFrom` the
 *   first message under the "new" divider, both as Slack `ts`.
 * - `person` and `channel`: from Ask Juno in a menu. A name and an id only,
 *   so the run stays clean until Juno reads.
 *
 * `person` on a topic or a channel is the other person of a one-to-one DM,
 * by Slack user id, so the run gets Juno's file on them (SPEC 13.8).
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
    person: Schema.optionalKey(Schema.String),
  }),
  Schema.TaggedStruct('person', { userId: Schema.String, name: Schema.String }),
  Schema.TaggedStruct('channel', { place: Place, person: Schema.optionalKey(Schema.String) }),
])
export type SendContext = typeof SendContext.Type

/**
 * A person or channel the owner picked with @ or # in the Juno composer
 * (SPEC 13.1). `name` is as the field shows it after the trigger ("Maya
 * Chen", "eng"); the owner's words keep it as typed, and Juno reads the id
 * beside them, so a name is never a guess.
 */
export const ChatMention = Schema.Struct({ kind: Schema.Literals(['person', 'channel']), id: Schema.String, name: Schema.String })
export type ChatMention = typeof ChatMention.Type

/** The "About …" line over an owner bubble: what the message was about, by name. */
export const About = Schema.Union([
  Schema.TaggedStruct('topic', { topicId: Schema.String, title: Schema.String }),
  Schema.TaggedStruct('person', { userId: Schema.String, name: Schema.String }),
  Schema.TaggedStruct('channel', { channelId: Schema.String, name: Schema.String, tint: PlaceTint }),
])
export type About = typeof About.Type

