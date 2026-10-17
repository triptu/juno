/** Shared card projection schemas. agent-contract re-exports these on the wire. */
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
export const isT3ThreadUrl = (url: string): boolean => /^t3-thread:\/\/v1\/[a-zA-Z0-9_-]+$/.test(url)
export const isOpenableUrl = (url: string): boolean => OPENABLE.test(url) || isT3ThreadUrl(url)
export const OpenableUrl = Schema.String.check(
  Schema.makeFilter((url: string) => isOpenableUrl(url) || 'an https: URL, http: on loopback, or a T3 thread link', {
    title: 'OpenableUrl',
  }),
)
export type OpenableUrl = typeof OpenableUrl.Type
export const JunoPage = Schema.Literals(['scheduled', 'remembers', 'memory', 'activity', 'connections', 'settings', 'review'])
export type JunoPage = typeof JunoPage.Type
export const OpenTarget = Schema.Union([
  Schema.TaggedStruct('topic', { topicId: Schema.String }),
  Schema.TaggedStruct('chatMessage', { messageId: ChatMessageId }),
  Schema.TaggedStruct('message', { channelId: Schema.String, ts: Schema.String }),
  Schema.TaggedStruct('url', { url: OpenableUrl, label: Schema.String }),
  Schema.TaggedStruct('page', { page: JunoPage }),
])
export type OpenTarget = typeof OpenTarget.Type

/**
 * Where a card is in its life. One machine for every kind:
 *
 *   open ─click─▶ working ─▶ done | failed
 *   open ─▶ dismissed | expired
 *
 * `done` and `failed` carry the line the card shows afterwards ("Resolved
 * 3", "Failed"), so the view prints it and never composes it. An action
 * whose outcome Juno cannot confirm (plan v3 §6.3) shows as `failed` too. A
 * card runs once: there is no retry button. To try again the owner checks
 * by hand or asks Juno, who proposes a new card. An `open` card restored from a backup (plan v3 §14.3)
 * carries `mayHaveHappened`: the buttons stay and the card says "This may
 * already have happened." above them.
 */
export const CardStatus = Schema.Union([
  Schema.TaggedStruct('open', { mayHaveHappened: Schema.optionalKey(Schema.Literal(true)) }),
  /** The click landed; buttons are disabled until the outcome arrives. */
  Schema.TaggedStruct('working', {}),
  Schema.TaggedStruct('done', {
    line: Schema.String,
    /** One plain line of what came back ("Found 3 results", a new page's title), for a connection call. */
    detail: Schema.optionalKey(Schema.String),
    /** All of what came back, as a person reads it and trimmed, behind "Show result". */
    result: Schema.optionalKey(Schema.String),
    /** "Undo" after a resolve or a remember. */
    undo: Schema.optionalKey(Schema.Literal(true)),
    open: Schema.optionalKey(OpenTarget),
  }),
  Schema.TaggedStruct('dismissed', {}),
  /** After 7 days, or when the source changed: "Expired · Ask again". */
  Schema.TaggedStruct('expired', {}),
  /** `detail`: the destination's error, in one short line, and `result` all of it, for a connection call. */
  Schema.TaggedStruct('failed', { line: Schema.String, detail: Schema.optionalKey(Schema.String), result: Schema.optionalKey(Schema.String) }),
])
export type CardStatus = typeof CardStatus.Type

/** What every card carries. */
const base = {
  id: CardId,
  status: CardStatus,
  /**
   * The "Because" line: why this is a card and not a quiet action, in
   * Juno's words ("Because a message from #eng was in this reply"). Shown
   * on cards a tainted run produced (plan v3 §6.4).
   */
  because: Schema.optionalKey(Schema.String),
}

/**
 * One row's outcome on a Send message card. Every row starts `pending`;
 * Send moves them all to `sending`, and each settles on its own.
 */
export const SendResult = Schema.Union([
  Schema.TaggedStruct('pending', {}),
  Schema.TaggedStruct('sending', {}),
  Schema.TaggedStruct('sent', { open: OpenTarget }),
  /** Rejected, or Juno could not confirm it. The row says "Failed" and offers nothing. */
  Schema.TaggedStruct('failed', {}),
])
export type SendResult = typeof SendResult.Type

/** One proposed Slack message. The text is editable until Send. */
export const ProposedMessage = Schema.Struct({
  id: ProposedMessageId,
  target: Place,
  /** Set when the message replies inside a thread: "in {topic title}". */
  inTopic: Schema.optionalKey(TopicLink),
  text: Schema.String,
  result: SendResult,
})
export type ProposedMessage = typeof ProposedMessage.Type

export const SendMessageCard = Schema.TaggedStruct('sendMessage', {
  ...base,
  /**
   * One to five messages. One Send sends them all; results are per row, and
   * the card's `status` after Send follows them (`sendMessageStatus`).
   */
  messages: Schema.Array(ProposedMessage).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
})
export type SendMessageCard = typeof SendMessageCard.Type

/**
 * The card status a Send message card takes after Send, from its rows.
 * `working` while any row is unresolved. Then `done` with a count when at
 * least one row was sent, and `failed` when none was.
 */
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

/** Links only. No buttons and no status change: `status` stays `open`. */
export const TopicsCard = Schema.TaggedStruct('topics', {
  ...base,
  links: Schema.Array(TopicLink).check(Schema.isMinLength(1)),
})
export type TopicsCard = typeof TopicsCard.Type

/** Where a job runs. Shown as the card's source: "T3 Code", "Juno". */
export const JobKind = Schema.Literals(['t3', 'subagent'])
export type JobKind = typeof JobKind.Type

/**
 * A job proposed from a tainted run (plan v3 §6.4). It has no job yet: the
 * owner's Start click mints the grant and starts it, and the card's
 * `status` is that click's machine ("Started", or a failure). Once the job
 * exists a `task` card follows under Juno's next message.
 */
export const ProposedTaskCard = Schema.TaggedStruct('proposedTask', {
  ...base,
  kind: JobKind,
  /** The task in the owner's words: "Fix the sidebar flake". */
  title: Schema.String,
  /** Where it would run: a project or worktree name, or the subagent's model. */
  where: Schema.String,
})
export type ProposedTaskCard = typeof ProposedTaskCard.Type

/**
 * A job's phase, for the card's state line and buttons. The live line
 * itself is written by the agent ("Tests running, 2 of 5") and changes at
 * most every 2 s; the settled phases print fixed copy from
 * `chatCopy.card.task`.
 */
export const JobPhase = Schema.Literals([
  'running',
  /** T3 asked something; a `question` card follows. */
  'needsYou',
  /** The T3 sign-in expired: "Sign in to T3 Code to keep watching". */
  'lostSight',
  'done',
  'failed',
  'stopping',
  'stopped',
])
export type JobPhase = typeof JobPhase.Type

/**
 * A running or settled job. It is the one card without `status`: a job is
 * not a click waiting for an outcome, and `phase` is its only machine.
 * Stop is the only way to end a job (plan v3 B5). A job Juno cannot tell
 * started or still runs shows as `failed`.
 */
export const TaskCard = Schema.TaggedStruct('task', {
  id: CardId,
  because: Schema.optionalKey(Schema.String),
  jobId: JobId,
  kind: JobKind,
  /** The task in the owner's words: "Fix the sidebar flake". */
  title: Schema.String,
  /** Where it runs: a project or worktree name, or the subagent's model. */
  where: Schema.String,
  phase: JobPhase,
  /** The live state line under the title, while `running`, `needsYou` or `stopping`. */
  state: Schema.optionalKey(Schema.String),
  stopFailed: Schema.optionalKey(Schema.Boolean),
  /** Open the thread, or the PR once there is one. */
  open: Schema.optionalKey(OpenTarget),
})
export type TaskCard = typeof TaskCard.Type

export const QuestionOption = Schema.Struct({ id: QuestionOptionId, label: Schema.String })
export type QuestionOption = typeof QuestionOption.Type

/** Who asks, as the header reads: "Juno asks", or "T3 Code asks" with the job's pill. */
export const Asker = Schema.Union([Schema.TaggedStruct('juno', {}), Schema.TaggedStruct('t3', { job: JobRef })])
export type Asker = typeof Asker.Type

export const QuestionCard = Schema.TaggedStruct('question', {
  ...base,
  asks: Asker,
  prompt: Schema.String,
  options: Schema.Array(QuestionOption).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
  /** Also take a typed reply. */
  freeText: Schema.Boolean,
})
export type QuestionCard = typeof QuestionCard.Type

/** How a schedule's message reaches the owner (SPEC §14). */
export const Deliver = Schema.Literals(['now', 'digest', 'silent'])
export type Deliver = typeof Deliver.Type

const scheduleFields = {
  /** What Juno will do, in its words: "Catch you up on #eng". */
  what: Schema.String,
  /** When, in words: "Weekdays at 9:00", "Once, 3 Nov at 14:00". */
  when: Schema.String,
  deliver: Deliver,
}

/**
 * A schedule proposed from a tainted run. Start creates it; `status` is that
 * click. `prompt` is the instruction each wake will run, word for word from
 * the stored payload: the click approves it, so the card shows all of it
 * (plan v3 §6.4, G6).
 */
export const ProposedScheduleCard = Schema.TaggedStruct('proposedSchedule', { ...base, ...scheduleFields, prompt: Schema.String })
export type ProposedScheduleCard = typeof ProposedScheduleCard.Type

/**
 * A schedule Juno created from a clean run. Keep, Pause and Delete each
 * settle `status` with a fixed line ("Kept", "Paused", "Deleted").
 */
export const ScheduleCard = Schema.TaggedStruct('schedule', { ...base, ...scheduleFields, scheduleId: ScheduleId })
export type ScheduleCard = typeof ScheduleCard.Type

export const ConnectCard = Schema.TaggedStruct('connect', {
  ...base,
  /** "Notion", "Littlebird", "T3 Code". */
  server: Schema.String,
  scopes: Schema.Array(Schema.String),
  /** One sentence on what leaves the machine once connected. */
  leaves: Schema.String,
})
export type ConnectCard = typeof ConnectCard.Type

/** One field of a `change` card's preview, rendered from the payload. */
export const ChangeField = Schema.Struct({
  name: Schema.String,
  before: Schema.optionalKey(Schema.String),
  after: Schema.String,
  /** Over 280 characters: the view shows a head and "Show all". */
  long: Schema.optionalKey(Schema.Literal(true)),
})
export type ChangeField = typeof ChangeField.Type

/**
 * The auto-review of one connection call (SPEC 13.9). `rule` is the owner's
 * rule that applied. `intent` and `risk` are the reviewer's two answers; both
 * are absent when no review ran (Always ask, or Never ask in a clean run) and
 * `failed` is set when the review call failed or timed out. `line` is fixed
 * copy saying why Juno asked, or why it ran without asking.
 */
export const ReviewRule = Schema.Literals(['auto', 'always', 'never'])
export type ReviewRule = typeof ReviewRule.Type
export const ReviewIntent = Schema.Literals(['explicit', 'implied', 'notAsked'])
export type ReviewIntent = typeof ReviewIntent.Type
export const ReviewRisk = Schema.Literals(['read', 'reversible', 'write', 'delete', 'send'])
export type ReviewRisk = typeof ReviewRisk.Type
export const ToolReview = Schema.Struct({
  rule: ReviewRule,
  intent: Schema.optionalKey(ReviewIntent),
  risk: Schema.optionalKey(ReviewRisk),
  failed: Schema.optionalKey(Schema.Literal(true)),
  line: Schema.String,
})
export type ToolReview = typeof ToolReview.Type

export const ChangeCard = Schema.TaggedStruct('change', {
  ...base,
  server: Schema.String,
  /** The page, record or routine that changes, as its title. */
  target: Schema.String,
  fields: Schema.Array(ChangeField).check(Schema.isMinLength(1)),
  /** The model's one-line caption. Never the thing the owner approves. */
  caption: Schema.optionalKey(Schema.String),
  /** Why Juno asked: the auto-review of a connection call. */
  review: Schema.optionalKey(ToolReview),
  /** The header, by what the call does ("Search Littlebird"), and the button's verb ("Search"). Older cards have neither. */
  title: Schema.optionalKey(Schema.String),
  verb: Schema.optionalKey(Schema.String),
})
export type ChangeCard = typeof ChangeCard.Type

/**
 * A removal Juno proposes ("forget what I said about the offsite"). The
 * owner's own Remove is the local sheet (`RemoveSheet`), never a card.
 */
export const RemoveCard = Schema.TaggedStruct('remove', {
  ...base,
  messages: Schema.Array(
    Schema.Struct({
      messageId: ChatMessageId,
      /** The first line, for the owner to recognise it. */
      preview: Schema.String,
      at: Schema.Number,
    }),
  ).check(Schema.isMinLength(1)),
  /** The next message is Juno's reply: offer "Also remove Juno's reply". */
  offerReply: Schema.optionalKey(ChatMessageId),
})
export type RemoveCard = typeof RemoveCard.Type

export const BudgetCard = Schema.TaggedStruct('budget', {
  ...base,
  spentTodayUsd: Schema.Number,
  capUsd: Schema.Number,
})
export type BudgetCard = typeof BudgetCard.Type

/** The provider disclosure is fixed copy (`chatCopy.card.provider.disclosure`), shown on every provider card. */
export const ProviderCard = Schema.TaggedStruct('provider', {
  ...base,
  options: Schema.Array(
    Schema.Struct({
      id: Schema.Literals(['openrouter', 'codex']),
      label: Schema.String,
      /** "Needs an API key", "Uses your ChatGPT plan on this Mac". */
      note: Schema.String,
    }),
  ),
})
export type ProviderCard = typeof ProviderCard.Type

/** A kind this build does not know. Renders "This card needs a newer Juno". */
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
