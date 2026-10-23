import { ChannelId, ConversationKind, needsYouOptions, UserId } from '@juno/domain'
import { Schema, type Effect } from 'effect'

/** The facts the decision read, as `readConversation` found them when the message arrived. */
const Facts = Schema.Struct({
  ownerWroteMinutesAgo: Schema.optionalKey(Schema.Number),
  ownerWroteLast: Schema.optionalKey(Schema.Boolean),
  ownerStartedThread: Schema.optionalKey(Schema.Boolean),
  followed: Schema.optionalKey(Schema.Boolean),
  bannerSecondsAgo: Schema.optionalKey(Schema.Number),
})

export const Candidate = Schema.Struct({
  channel: Schema.Struct({ id: ChannelId, kind: ConversationKind, name: Schema.String, ignored: Schema.Boolean }),
  senderId: UserId,
  senderName: Schema.optionalKey(Schema.String),
  mentionsMe: Schema.Boolean,
  /** By name or a group the owner is in, not @here: gets through Never and ignored. Absent in rows logged before it existed. */
  mentionsMeDirectly: Schema.optionalKey(Schema.Boolean),
  ts: Schema.String,
  topicId: Schema.String,
  text: Schema.String,
  /** Absent in rows logged before 2026-10-23, and on the way in. */
  facts: Schema.optionalKey(Facts),
})
export type Candidate = typeof Candidate.Type

/** Juno's reading as stored with the row, or `failed` when it did not come in time. Older rows hold another shape and read as none. */
export const StoredReading = Schema.Union([
  Schema.Struct({
    needsYou: Schema.Literals(needsYouOptions),
    probabilities: Schema.Record(Schema.String, Schema.Number),
    instruction: Schema.optionalKey(Schema.Struct({ id: Schema.String, confidence: Schema.Number })),
  }),
  Schema.Literal('failed'),
])
export type StoredReading = typeof StoredReading.Type

export interface MessageSource {
  readonly channelId: string
  readonly ts: string
  readonly topicId: string
}
export type NotificationTarget = { readonly kind: 'message'; readonly source: MessageSource }
export interface Notification {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly target: NotificationTarget
}
export interface Notifier {
  readonly show: (notification: Notification) => Effect.Effect<void>
  readonly viewing: (topicId: string) => Effect.Effect<boolean>
}
