/**
 * Card view models: the catalogue of plan v3 §12 as the chat renders it.
 *
 * A card sits under a Juno bubble at column width. Its props are what the
 * owner reads before a click, never the engine's payload: the agent renders
 * a `change` card's field preview from the stored payload before it reaches
 * the renderer, so a model-written summary can never stand in for it.
 *
 * Every card but `task` has one `status`. The kinds differ only in what
 * they show and which buttons they offer. The model cannot invent a kind:
 * an id the renderer does not know arrives as `unknown` and renders one
 * line.
 */
import { Schema } from 'effect'
import { CardId, ChatMessageId, JobId, ProposedMessageId, QuestionOptionId, ScheduleId } from './ids'
import { JobRef, OpenTarget, Place, TopicLink } from './place'

/**
 * Where a card is in its life. One machine for every kind:
 *
 *   open ─click─▶ working ─▶ done | failed | unknown
 *   open ─▶ dismissed | expired
 *
 * `done`, `failed` and `unknown` carry the line the card shows afterwards
 * ("Resolved 3", "Not sent", "Juno can't tell whether this was sent"), so
 * the view prints it and never composes it. `unknown` is an action whose
 * outcome the agent cannot prove either way (plan v3 §6.3); its retry says
 * it may duplicate. An `open` card restored from a backup (plan v3 §14.3)
 * carries `mayHaveHappened`: the buttons stay and the card says "This may
 * already have happened." above them.
 */
export const CardStatus = Schema.Union([
  Schema.TaggedStruct('open', { mayHaveHappened: Schema.optionalKey(Schema.Literal(true)) }),
  /** The click landed; buttons are disabled until the outcome arrives. */
  Schema.TaggedStruct('working', {}),
  Schema.TaggedStruct('done', {
    line: Schema.String,
    /** "Undo" after a resolve or a remember. */
    undo: Schema.optionalKey(Schema.Literal(true)),
    open: Schema.optionalKey(OpenTarget),
  }),
  Schema.TaggedStruct('dismissed', {}),
  /** After 7 days, or when the source changed: "Expired · Ask again". */
  Schema.TaggedStruct('expired', {}),
  Schema.TaggedStruct('failed', {
    line: Schema.String,
    /** Offer "Try again". The retry is a new click and a new authorization. */
    retry: Schema.optionalKey(Schema.Literal(true)),
  }),
  Schema.TaggedStruct('unknown', {
    line: Schema.String,
    /** Where the owner can look: the channel for a send, the thread for T3. */
    check: Schema.optionalKey(OpenTarget),
  }),
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
  Schema.TaggedStruct('notSent', {}),
  /** The send may have landed. "Check channel" or "Send again". */
  Schema.TaggedStruct('unknown', { check: OpenTarget }),
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
 * least one row was sent, `unknown` when none was and one may have been,
 * and `failed` with a retry when none was.
 */
export const sendMessageStatus = (messages: ReadonlyArray<ProposedMessage>): CardStatus => {
  const results = messages.map((m) => m.result._tag)
  if (results.some((r) => r === 'pending' || r === 'sending')) return { _tag: 'working' }
  const sent = results.filter((r) => r === 'sent').length
  if (sent === messages.length) return { _tag: 'done', line: sent === 1 ? 'Sent' : `Sent ${sent}` }
  if (sent > 0) return { _tag: 'done', line: `Sent ${sent} of ${messages.length}` }
  if (results.includes('unknown')) return { _tag: 'unknown', line: "Juno can't tell whether this was sent." }
  return { _tag: 'failed', line: 'Not sent', retry: true }
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
  /** No step change for 30 minutes. Still watched. */
  'quiet',
  /** The T3 sign-in expired: "Sign in to T3 Code to keep watching". */
  'lostSight',
  'done',
  'failed',
  'stopping',
  'stopped',
  /** Juno cannot tell whether the job started or still runs (plan v3 §6.5). */
  'unknown',
])
export type JobPhase = typeof JobPhase.Type

/**
 * A running or settled job. It is the one card without `status`: a job is
 * not a click waiting for an outcome, and `phase` is its only machine.
 * Stop is the only way to end a job (plan v3 B5).
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

/** A schedule proposed from a tainted run. Start creates it; `status` is that click. */
export const ProposedScheduleCard = Schema.TaggedStruct('proposedSchedule', { ...base, ...scheduleFields })
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

export const ChangeCard = Schema.TaggedStruct('change', {
  ...base,
  server: Schema.String,
  /** The page, record or routine that changes, as its title. */
  target: Schema.String,
  fields: Schema.Array(ChangeField).check(Schema.isMinLength(1)),
  /** The model's one-line caption. Never the thing the owner approves. */
  caption: Schema.optionalKey(Schema.String),
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
