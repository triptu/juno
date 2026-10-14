/** Structural projection types. Keep compatible with WP7 without reversing the package graph.
 * agent-contract/test/card-shape.test.ts checks the encoded AST and every card kind. */
import { Schema } from 'effect'

export const ChatMessageId = Schema.String.pipe(Schema.brand('ChatMessageId'))
export type ChatMessageId = typeof ChatMessageId.Type
export const OpId = Schema.String.pipe(Schema.brand('OpId'))
export type OpId = typeof OpId.Type
export const CardId = Schema.String.pipe(Schema.brand('CardId'))
export type CardId = typeof CardId.Type
export const ProposedMessageId = Schema.String.pipe(Schema.brand('ProposedMessageId'))
export type ProposedMessageId = typeof ProposedMessageId.Type
export const QuestionOptionId = Schema.String.pipe(Schema.brand('QuestionOptionId'))
export type QuestionOptionId = typeof QuestionOptionId.Type
export const JobId = Schema.String.pipe(Schema.brand('JobId'))
export type JobId = typeof JobId.Type
export const ScheduleId = Schema.String.pipe(Schema.brand('ScheduleId'))
export type ScheduleId = typeof ScheduleId.Type
export const RunId = Schema.String.pipe(Schema.brand('RunId'))
export type RunId = typeof RunId.Type
export const PinId = Schema.String.pipe(Schema.brand('PinId'))
export type PinId = typeof PinId.Type
export const ConnectionId = Schema.String.pipe(Schema.brand('ConnectionId'))
export type ConnectionId = typeof ConnectionId.Type

export const PlaceTint = Schema.Literals(['public', 'private', 'dm'])
export type PlaceTint = typeof PlaceTint.Type
export const Place = Schema.Struct({
  channelId: Schema.String,
  name: Schema.String,
  kindLabel: Schema.String,
  tint: PlaceTint,
})
export type Place = typeof Place.Type
export const JobRef = Schema.Struct({ jobId: JobId, title: Schema.String })
export type JobRef = typeof JobRef.Type
export const TopicLink = Schema.Struct({
  topicId: Schema.String,
  title: Schema.String,
  where: Schema.String,
  tint: PlaceTint,
})
export type TopicLink = typeof TopicLink.Type
const OPENABLE = /^(?:https:\/\/[^\s/?#]+|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)(?:[/?#]|$)/i
export const isOpenableUrl = (url: string): boolean => OPENABLE.test(url)
export const OpenableUrl = Schema.String.check(
  Schema.makeFilter((url: string) => isOpenableUrl(url) || 'an https: URL, or http: on loopback', {
    title: 'OpenableUrl',
  }),
)
export type OpenableUrl = typeof OpenableUrl.Type
export const JunoPage = Schema.Literals(['scheduled', 'remembers', 'memory', 'activity', 'connections', 'settings', 'review'])
export type JunoPage = typeof JunoPage.Type
export const OpenTarget = Schema.Union([
  Schema.TaggedStruct('topic', { topicId: Schema.String }),
  Schema.TaggedStruct('chatMessage', { messageId: ChatMessageId }),
  Schema.TaggedStruct('url', { url: OpenableUrl, label: Schema.String }),
  Schema.TaggedStruct('page', { page: JunoPage }),
])
export type OpenTarget = typeof OpenTarget.Type

export const CardStatus = Schema.Union([
  Schema.TaggedStruct('open', { mayHaveHappened: Schema.optionalKey(Schema.Literal(true)) }),
  Schema.TaggedStruct('working', {}),
  Schema.TaggedStruct('done', {
    line: Schema.String,
    undo: Schema.optionalKey(Schema.Literal(true)),
    open: Schema.optionalKey(OpenTarget),
  }),
  Schema.TaggedStruct('dismissed', {}),
  Schema.TaggedStruct('expired', {}),
  Schema.TaggedStruct('failed', { line: Schema.String }),
])
export type CardStatus = typeof CardStatus.Type
const base = {
  id: CardId,
  status: CardStatus,
  because: Schema.optionalKey(Schema.String),
}
export const SendResult = Schema.Union([
  Schema.TaggedStruct('pending', {}),
  Schema.TaggedStruct('sending', {}),
  Schema.TaggedStruct('sent', { open: OpenTarget }),
  Schema.TaggedStruct('failed', {}),
])
export type SendResult = typeof SendResult.Type
export const ProposedMessage = Schema.Struct({
  id: ProposedMessageId,
  target: Place,
  inTopic: Schema.optionalKey(TopicLink),
  text: Schema.String,
  result: SendResult,
})
export type ProposedMessage = typeof ProposedMessage.Type
export const SendMessageCard = Schema.TaggedStruct('sendMessage', {
  ...base,
  messages: Schema.Array(ProposedMessage).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
})
export type SendMessageCard = typeof SendMessageCard.Type
export const sendMessageStatus = (messages: ReadonlyArray<ProposedMessage>): CardStatus => {
  const results = messages.map((m) => m.result._tag)
  if (results.some((r) => r === 'pending' || r === 'sending')) return { _tag: 'working' }
  const sent = results.filter((r) => r === 'sent').length
  if (sent === messages.length) return { _tag: 'done', line: sent === 1 ? 'Sent' : `Sent ${sent}` }
  if (sent > 0) return { _tag: 'done', line: `Sent ${sent} of ${messages.length}` }
  return { _tag: 'failed', line: 'Failed' }
}
export const ResolveCard = Schema.TaggedStruct('resolve', {
  ...base,
  topics: Schema.Array(TopicLink).check(Schema.isMinLength(1)),
})
export type ResolveCard = typeof ResolveCard.Type
export const TopicsCard = Schema.TaggedStruct('topics', {
  ...base,
  links: Schema.Array(TopicLink).check(Schema.isMinLength(1)),
})
export type TopicsCard = typeof TopicsCard.Type
export const JobKind = Schema.Literals(['t3', 'subagent'])
export type JobKind = typeof JobKind.Type
export const ProposedTaskCard = Schema.TaggedStruct('proposedTask', {
  ...base,
  kind: JobKind,
  title: Schema.String,
  where: Schema.String,
})
export type ProposedTaskCard = typeof ProposedTaskCard.Type
export const JobPhase = Schema.Literals([
  'running',
  'needsYou',
  'lostSight',
  'done',
  'failed',
  'stopping',
  'stopped',
])
export type JobPhase = typeof JobPhase.Type
export const TaskCard = Schema.TaggedStruct('task', {
  id: CardId,
  because: Schema.optionalKey(Schema.String),
  jobId: JobId,
  kind: JobKind,
  title: Schema.String,
  where: Schema.String,
  phase: JobPhase,
  state: Schema.optionalKey(Schema.String),
  open: Schema.optionalKey(OpenTarget),
})
export type TaskCard = typeof TaskCard.Type
export const QuestionOption = Schema.Struct({ id: QuestionOptionId, label: Schema.String })
export type QuestionOption = typeof QuestionOption.Type
export const Asker = Schema.Union([Schema.TaggedStruct('juno', {}), Schema.TaggedStruct('t3', { job: JobRef })])
export type Asker = typeof Asker.Type
export const QuestionCard = Schema.TaggedStruct('question', {
  ...base,
  asks: Asker,
  prompt: Schema.String,
  options: Schema.Array(QuestionOption).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
  freeText: Schema.Boolean,
})
export type QuestionCard = typeof QuestionCard.Type
export const Deliver = Schema.Literals(['now', 'digest', 'silent'])
export type Deliver = typeof Deliver.Type
const scheduleFields = {
  what: Schema.String,
  when: Schema.String,
  deliver: Deliver,
}
export const ProposedScheduleCard = Schema.TaggedStruct('proposedSchedule', { ...base, ...scheduleFields, prompt: Schema.String })
export type ProposedScheduleCard = typeof ProposedScheduleCard.Type
export const ScheduleCard = Schema.TaggedStruct('schedule', { ...base, ...scheduleFields, scheduleId: ScheduleId })
export type ScheduleCard = typeof ScheduleCard.Type
export const ConnectCard = Schema.TaggedStruct('connect', {
  ...base,
  server: Schema.String,
  scopes: Schema.Array(Schema.String),
  leaves: Schema.String,
})
export type ConnectCard = typeof ConnectCard.Type
export const ChangeField = Schema.Struct({
  name: Schema.String,
  before: Schema.optionalKey(Schema.String),
  after: Schema.String,
  long: Schema.optionalKey(Schema.Literal(true)),
})
export type ChangeField = typeof ChangeField.Type
export const ChangeCard = Schema.TaggedStruct('change', {
  ...base,
  server: Schema.String,
  target: Schema.String,
  fields: Schema.Array(ChangeField).check(Schema.isMinLength(1)),
  caption: Schema.optionalKey(Schema.String),
})
export type ChangeCard = typeof ChangeCard.Type
export const RemoveCard = Schema.TaggedStruct('remove', {
  ...base,
  messages: Schema.Array(
    Schema.Struct({
      messageId: ChatMessageId,
      preview: Schema.String,
      at: Schema.Number,
    }),
  ).check(Schema.isMinLength(1)),
  offerReply: Schema.optionalKey(ChatMessageId),
})
export type RemoveCard = typeof RemoveCard.Type
export const BudgetCard = Schema.TaggedStruct('budget', {
  ...base,
  spentTodayUsd: Schema.Number,
  capUsd: Schema.Number,
})
export type BudgetCard = typeof BudgetCard.Type
export const ProviderCard = Schema.TaggedStruct('provider', {
  ...base,
  options: Schema.Array(
    Schema.Struct({
      id: Schema.Literals(['openrouter', 'codex']),
      label: Schema.String,
      note: Schema.String,
    }),
  ),
})
export type ProviderCard = typeof ProviderCard.Type
export const UnknownCard = Schema.TaggedStruct('unknown', { id: CardId, kind: Schema.String })
export type UnknownCard = typeof UnknownCard.Type
export const Card = Schema.Union([
  SendMessageCard,
  ResolveCard,
  TopicsCard,
  ProposedTaskCard,
  TaskCard,
  QuestionCard,
  ProposedScheduleCard,
  ScheduleCard,
  ConnectCard,
  ChangeCard,
  RemoveCard,
  BudgetCard,
  ProviderCard,
  UnknownCard,
])
export type Card = typeof Card.Type
export type CardKind = Card['_tag']
