import { Schema } from 'effect'
import { ActionId, ChildAction, Revision, SourceGeneration, canonicalJson, digestJson } from './identity'
import * as P from './presentation'

const base = { because: Schema.optionalKey(Schema.String) }
const action = { ...base, action: ChildAction }

/** Display labels travel with the immutable proposal, but never replace executable ids. */
export const SendMessagePayload = Schema.TaggedStruct('sendMessage', {
  ...base,
  messages: Schema.Array(Schema.Struct({
    id: P.ProposedMessageId,
    actionId: ActionId,
    rev: Revision,
    source: SourceGeneration,
    connectionId: Schema.String.pipe(Schema.brand('ConnectionId')),
    accountId: Schema.String.pipe(Schema.brand('AgentAccountId')),
    schemaHash: ChildAction.fields.payload.fields.schema_hash,
    target: P.Place,
    inTopic: Schema.optionalKey(P.TopicLink),
    threadTs: Schema.optionalKey(Schema.String),
    text: Schema.String,
    preconditions: Schema.Json,
  })).check(Schema.isMinLength(1), Schema.isMaxLength(5), Schema.makeFilter((messages) =>
    new Set(messages.map((m) => m.actionId)).size === messages.length &&
    new Set(messages.map((m) => m.id)).size === messages.length || 'Message and action ids must be unique')),
})
export const ResolvePayload = Schema.TaggedStruct('resolve', { ...action, topics: Schema.NonEmptyArray(P.TopicLink) })
export const TopicsPayload = Schema.TaggedStruct('topics', { ...base, links: Schema.NonEmptyArray(P.TopicLink) })
export const ProposedTaskPayload = Schema.TaggedStruct('proposedTask', {
  ...action, kind: P.JobKind, title: Schema.String, where: Schema.String,
})
export const TaskPayload = Schema.TaggedStruct('task', {
  ...base, jobId: P.JobId, kind: P.JobKind, title: Schema.String, where: Schema.String,
})
export const QuestionPayload = Schema.TaggedStruct('question', {
  ...action, asks: P.Asker, prompt: Schema.String,
  options: Schema.Array(P.QuestionOption).check(Schema.isMinLength(2), Schema.isMaxLength(4)), freeText: Schema.Boolean,
})
const schedule = { what: Schema.String, when: Schema.String, deliver: P.Deliver }
/** `prompt` is the exact instruction each wake runs. The card renders it in full (G6). */
export const ProposedSchedulePayload = Schema.TaggedStruct('proposedSchedule', { ...action, ...schedule, prompt: Schema.String })
export const SchedulePayload = Schema.TaggedStruct('schedule', { ...action, ...schedule, scheduleId: P.ScheduleId })
export const ConnectPayload = Schema.TaggedStruct('connect', {
  ...action, server: Schema.String, scopes: Schema.Array(Schema.String), leaves: Schema.String,
})
/** The preview is always the complete stored args. A model cannot supply preview fields. */
export const ChangePayload = Schema.TaggedStruct('change', {
  ...action, server: Schema.String, target: Schema.String, caption: Schema.optionalKey(Schema.String),
})
export const RemovePayload = Schema.TaggedStruct('remove', {
  ...action, messages: P.RemoveCard.fields.messages, offerReply: Schema.optionalKey(P.ChatMessageId),
})
export const BudgetPayload = Schema.TaggedStruct('budget', {
  ...action, spentTodayUsd: Schema.Number.check(Schema.isFinite()), capUsd: Schema.Number.check(Schema.isFinite()),
})
export const ProviderPayload = Schema.TaggedStruct('provider', { ...action, options: P.ProviderCard.fields.options })
export const payloadSchemas = {
  sendMessage: SendMessagePayload, resolve: ResolvePayload, topics: TopicsPayload,
  proposedTask: ProposedTaskPayload, task: TaskPayload, question: QuestionPayload,
  proposedSchedule: ProposedSchedulePayload, schedule: SchedulePayload, connect: ConnectPayload,
  change: ChangePayload, remove: RemovePayload, budget: BudgetPayload, provider: ProviderPayload,
}
export const CardPayload = Schema.Union(Object.values(payloadSchemas))
export type CardPayload = typeof CardPayload.Type
export const canonicalPayload = (payload: CardPayload): string => canonicalJson(Schema.encodeSync(CardPayload, { onExcessProperty: 'error' })(payload))
export const payloadDigest = (payload: CardPayload) => digestJson(Schema.encodeSync(CardPayload, { onExcessProperty: 'error' })(payload))
export const decodePayload = (encoded: string): CardPayload => Schema.decodeUnknownSync(CardPayload, { onExcessProperty: 'error' })(JSON.parse(encoded))
