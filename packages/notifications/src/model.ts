import { ChannelId, ConversationKind, UserId } from '@juno/domain'
import { Schema, type Effect } from 'effect'

export const Candidate = Schema.Struct({
  channel: Schema.Struct({ id: ChannelId, kind: ConversationKind, name: Schema.String, ignored: Schema.Boolean }),
  senderId: UserId,
  senderName: Schema.optionalKey(Schema.String),
  mentionsMe: Schema.Boolean,
  ts: Schema.String,
  topicId: Schema.String,
  text: Schema.String,
})
export type Candidate = typeof Candidate.Type
export const Judgement = Schema.Struct({ notify: Schema.Boolean, reason: Schema.String })
export type Judgement = typeof Judgement.Type

export interface MessageSource {
  readonly channelId: string
  readonly ts: string
  readonly topicId: string
}
export type NotificationTarget = { readonly kind: 'message'; readonly source: MessageSource } | { readonly kind: 'summary'; readonly id: string }
export interface Notification {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly target: NotificationTarget
}
export interface Notifier {
  readonly show: (notification: Notification) => Effect.Effect<void>
  /** The host appends one message with origin summary and source inlines, without a model run.
   * Must be idempotent by id. Return the chat message id used by notification clicks. */
  readonly summary: (input: { readonly id: string; readonly at: string; readonly sources: ReadonlyArray<MessageSource>; readonly title: string; readonly body: string }) => Effect.Effect<string>
  readonly viewing: (topicId: string) => Effect.Effect<boolean>
}
