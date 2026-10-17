/**
 * The pages behind the Juno header menu (plan v3 §13.3): Scheduled, What
 * Juno remembers, Memory of this chat, Activity, Connections and Settings ›
 * Juno, plus the recovery review. Rows only; the containers wire the edits.
 */
import { Schema } from 'effect'
import { Digest } from '@juno/agent-cards'
import { Card, Deliver, ReviewRule, ToolReview } from './cards'
import { ChatMessageId, ConnectionId, JobId, PinId, RunId, ScheduleId } from './ids'

/* Scheduled ---------------------------------------------------------------- */

export const ScheduleRow = Schema.Struct({
  id: ScheduleId,
  what: Schema.String,
  /** "Weekdays at 9:00". */
  when: Schema.String,
  /** The next run in ms, or none while paused. */
  nextAt: Schema.optionalKey(Schema.Number),
  deliver: Deliver,
  state: Schema.Literals(['active', 'paused']),
  /** Paused itself after 30 days without a change. Said once. */
  selfPaused: Schema.optionalKey(Schema.Literal(true)),
})
export type ScheduleRow = typeof ScheduleRow.Type

export const ScheduledPage = Schema.Struct({ schedules: Schema.Array(ScheduleRow) })
export type ScheduledPage = typeof ScheduledPage.Type

/* What Juno remembers ------------------------------------------------------ */

export const PinRow = Schema.Struct({
  id: PinId,
  text: Schema.String,
  /** A pin from the owner's own words points at the message it came from. An edited pin has no source. */
  source: Schema.optionalKey(Schema.Struct({ messageId: ChatMessageId, at: Schema.Number })),
  at: Schema.Number,
  /** The pin changed under an open edit: "This changed. Check it and save again." */
  changed: Schema.optionalKey(Schema.Literal(true)),
})
export type PinRow = typeof PinRow.Type

export const RemembersPage = Schema.Struct({
  pins: Schema.Array(PinRow),
  /** Bytes used of the 4 KB active budget, so the page can say when it is full. */
  usedBytes: Schema.Int,
  budgetBytes: Schema.Int,
})
export type RemembersPage = typeof RemembersPage.Type

/* Memory of this chat ------------------------------------------------------ */

/** One line of the view as a dated timeline. A masked line is being rebuilt after a removal. */
export const MemoryLine = Schema.Union([
  Schema.TaggedStruct('line', { id: Schema.String, from: Schema.Number, to: Schema.Number, text: Schema.String }),
  Schema.TaggedStruct('masked', { id: Schema.String, from: Schema.Number, to: Schema.Number }),
])
export type MemoryLine = typeof MemoryLine.Type

export const MemoryPage = Schema.Struct({
  lines: Schema.Array(MemoryLine),
  /** Messages after `covered` are not summarised yet. */
  coveredThrough: Schema.optionalKey(Schema.Number),
})
export type MemoryPage = typeof MemoryPage.Type

/* Activity ----------------------------------------------------------------- */

/** An action of Tier 1 to 3 under a run, with the decision that was made about it. */
export const ActivityAction = Schema.Struct({
  id: Schema.String,
  tier: Schema.Literals([1, 2, 3]),
  /** "Sent a message to #eng", "Started T3 Code on juno". */
  label: Schema.String,
  decision: Schema.Literals(['noClick', 'approved', 'dismissed', 'expired', 'refused']),
  outcome: Schema.Literals(['done', 'failed', 'unknown', 'pending', 'none']),
  /** Plain words for a failure, with the technical detail behind "Copy details". */
  failure: Schema.optionalKey(Schema.Struct({ text: Schema.String, details: Schema.String })),
  /** A connection call's auto-review: the rule, the reviewer's answers, and one line on why Juno asked or ran it. */
  review: Schema.optionalKey(ToolReview),
})
export type ActivityAction = typeof ActivityAction.Type

/** How a run ended, printed from `chatCopy.pages.activity.outcome`. */
export const RunOutcome = Schema.Literals(['replied', 'interrupted', 'blocked', 'failed', 'stayedQuiet'])
export type RunOutcome = typeof RunOutcome.Type

/** One read a codemode script made in a run, with its arguments as the script passed them. */
export const ActivityScriptCall = Schema.Struct({
  tool: Schema.String,
  args: Schema.String,
  /** `unfinished`: the run ended while the call ran, as after a crash. */
  outcome: Schema.Literals(['done', 'failed', 'cancelled', 'refused', 'unfinished']),
})
export type ActivityScriptCall = typeof ActivityScriptCall.Type

/**
 * What started a run, named so the owner knows it at a glance. A message is
 * the owner's own words, cut short; `words` is empty once it was removed.
 */
export const ActivityTrigger = Schema.Union([
  Schema.TaggedStruct('message', { words: Schema.String, files: Schema.Int }),
  Schema.TaggedStruct('reaction', { emoji: Schema.String }),
  Schema.TaggedStruct('schedule', { name: Schema.String }),
  Schema.TaggedStruct('job', { name: Schema.String }),
  /** An answer on a Question card: the question. */
  Schema.TaggedStruct('answer', { question: Schema.String }),
])
export type ActivityTrigger = typeof ActivityTrigger.Type

/** One tool call the run made, in order, with what it was given and what came back, both cut short. */
export const ActivityStep = Schema.Struct({
  /** "Read #eng", "Searched Slack", "Called Notion's create_page". */
  label: Schema.String,
  /** The arguments: "launch in:#eng". Absent when there were none, or a removal cleared them. */
  input: Schema.optionalKey(Schema.String),
  /** What came back: "12 lines", "Proposed a card", or an error's text. A read's result is counted, never kept. */
  result: Schema.optionalKey(Schema.String),
  /** `unfinished`: the run ended while the call ran, as after a crash. */
  outcome: Schema.Literals(['done', 'failed', 'unfinished']),
})
export type ActivityStep = typeof ActivityStep.Type

export const ActivityRun = Schema.Struct({
  id: RunId,
  trigger: ActivityTrigger,
  at: Schema.Number,
  outcome: RunOutcome,
  actions: Schema.Array(ActivityAction),
  /**
   * What the run read from outside Juno, by name, in the order it first read
   * them: "#eng", "Littlebird", "the topic beside the chat". Untrusted content.
   */
  sources: Schema.Array(Schema.String),
  /** The folded read line of the run's scripts: "Ran 1 script: 4 reads, 1 cancelled". */
  reads: Schema.optionalKey(Schema.String),
  /** Every call the run's scripts made, in order. */
  scriptCalls: Schema.optionalKey(Schema.Array(ActivityScriptCall)),
  /** The model's tool calls, in order, at most `ACTIVITY_STEPS_MAX`. */
  steps: Schema.Array(ActivityStep),
  /** Calls past `steps`. */
  moreSteps: Schema.optionalKey(Schema.Int),
  /** The run was tainted by untrusted content from here on, so it asked before acting. */
  tainted: Schema.Boolean,
  /** "Claude Sonnet 5.5", or two names when a fallback answered. Absent when the run made no request. */
  model: Schema.optionalKey(Schema.String),
  /** What the run's requests cost in dollars. Absent while any cost is unknown. */
  costUsd: Schema.optionalKey(Schema.Number),
})
export type ActivityRun = typeof ActivityRun.Type

/** The most steps one run sends; the page says how many more there were. */
export const ACTIVITY_STEPS_MAX = 30

/** Runs newest first. `moreAbove`: older runs exist past the window. */
export const ActivityPage = Schema.Struct({ runs: Schema.Array(ActivityRun), moreAbove: Schema.Boolean })
export type ActivityPage = typeof ActivityPage.Type

/* Connections -------------------------------------------------------------- */

export const ConnectionState = Schema.Literals(['off', 'connecting', 'ready', 'degraded', 'needsSignIn', 'error'])
export type ConnectionState = typeof ConnectionState.Type

export const DiscoveredTool = Schema.Struct({
  name: Schema.String,
  /** The schema the row was read at. */
  schemaHash: Schema.optionalKey(Digest),
  /**
   * A read: on the code's read list, with its schema unchanged since Juno
   * first saw it. Reads run with no review under any rule.
   */
  read: Schema.Boolean,
  /**
   * The server marked it read-only when Juno first saw it, and its schema is
   * unchanged. It skips the review only while Juno has read nothing in the
   * conversation, and never under Always ask. It keeps a rule.
   */
  readOnly: Schema.optionalKey(Schema.Literal(true)),
  /** The server's one-line description, shown and never trusted. */
  hint: Schema.optionalKey(Schema.String),
  /** Offered to Juno. Every tool is on until the owner turns it off. */
  enabled: Schema.Boolean,
  /** The owner's auto-review rule for this tool. `auto` follows the connection's rule. */
  review: ReviewRule,
  /** Its schema changed since Juno first saw it, so a read-only claim no longer counts. */
  changed: Schema.optionalKey(Schema.Literal(true)),
  /**
   * It appeared after the owner chose Never ask for the connection, and has
   * its own Auto until the owner sets a rule again. A changed tool is the same.
   */
  added: Schema.optionalKey(Schema.Literal(true)),
  /**
   * A rule the owner cannot change: `delete` always asks; `forbidden` (merge,
   * buy, force-push) is never offered to Juno.
   */
  locked: Schema.optionalKey(Schema.Literals(['delete', 'forbidden'])),
})
export type DiscoveredTool = typeof DiscoveredTool.Type

/**
 * The T3 Code address settings (plan v3 §10.2). Only the T3 row carries
 * them. `allowNetwork` is off by default; a non-loopback address is used
 * only when it is on. Public hosts require HTTPS; private IPv4 hosts may
 * use HTTP, though their OAuth sign-in may require HTTPS.
 */
export const T3Address = Schema.Struct({
  url: Schema.String,
  allowNetwork: Schema.Boolean,
})
export type T3Address = typeof T3Address.Type

export const ConnectionRow = Schema.Struct({
  id: ConnectionId,
  label: Schema.String,
  state: ConnectionState,
  /** What is wrong, in words, when degraded or in error. */
  detail: Schema.optionalKey(Schema.String),
  /** The address in use, shown for T3 Code. */
  address: Schema.optionalKey(Schema.String),
  /** Editable address settings; T3 Code only. */
  t3: Schema.optionalKey(T3Address),
  tools: Schema.Array(DiscoveredTool),
  enabled: Schema.Boolean,
  /** The owner's auto-review rule for every tool of this connection that has none of its own. */
  review: ReviewRule,
  /** The owner added this server; Remove deletes it. Notion, Littlebird and T3 Code stay. */
  removable: Schema.optionalKey(Schema.Literal(true)),
})
export type ConnectionRow = typeof ConnectionRow.Type

export const ConnectionsPage = Schema.Struct({ connections: Schema.Array(ConnectionRow) })
export type ConnectionsPage = typeof ConnectionsPage.Type

/* Review (recovery) --------------------------------------------------------- */

/**
 * The page behind the recovery banner's Review (plan v3 §14.3). Every
 * pending card is `open` with `mayHaveHappened`. Activate ends recovery;
 * cards still open are then expired. Outside recovery the page is empty.
 */
export const ReviewPage = Schema.Struct({
  /** When the backup Juno restored from was taken. Absent outside recovery. */
  backupAt: Schema.optionalKey(Schema.Number),
  /** A move: the code of the backup found. The owner checks it matches the old Mac's before Activate. */
  moveCode: Schema.optionalKey(Schema.String),
  /** No trusted deletion record checked this backup: the page says `chatCopy.pages.review.unchecked`. */
  unchecked: Schema.optionalKey(Schema.Literal(true)),
  pending: Schema.Array(Card),
})
export type ReviewPage = typeof ReviewPage.Type

/* Settings › Juno ---------------------------------------------------------- */

/**
 * One row of the model picker: on OpenRouter, a family resolved to today's
 * newest model; on a custom endpoint, one model it lists, by id.
 */
export const ModelChoice = Schema.Struct({
  /** "Claude Sonnet", or a custom endpoint's model id. */
  family: Schema.String,
  /** "Claude Sonnet 5.5". Absent when the catalogue has no model that fits. */
  resolved: Schema.optionalKey(Schema.String),
  provider: Schema.Literals(['openrouter', 'codex', 'custom']),
  /** "$3 in, $15 out per million tokens". */
  price: Schema.optionalKey(Schema.String),
  selected: Schema.Boolean,
})
export type ModelChoice = typeof ModelChoice.Type

/**
 * Who owns Juno's state (plan v3 §14.1). `active` is this Mac. `released`
 * is after "Move to another Mac": this Mac is read-only until the other one
 * takes over. `recovery` is after a restore, until Activate.
 */
export const Ownership = Schema.Union([
  Schema.TaggedStruct('active', { epoch: Schema.Int }),
  Schema.TaggedStruct('released', {
    epoch: Schema.Int,
    /** After a move: the code the other Mac must show. Absent until the final backup is written. */
    moveCode: Schema.optionalKey(Schema.String),
    /** The Mac that owns Juno now, when this one saw it in the backup folder. */
    deviceName: Schema.optionalKey(Schema.String),
  }),
  Schema.TaggedStruct('recovery', { pending: Schema.Int }),
])
export type Ownership = typeof Ownership.Type

/** Provider disambiguates the same family offered through two transports. */
export const modelChoiceKey = (model: Pick<ModelChoice, 'provider' | 'family'>): string => model.provider === 'codex' ? `codex:${model.family}` : model.family

/** A daily limit this high is "No limit" (Settings › AI activity). */
export const NO_LIMIT_USD = 1_000_000

export const JunoSettingsPage = Schema.Struct({
  chatModels: Schema.Array(ModelChoice),
  compactionModels: Schema.Array(ModelChoice),
  /**
   * The model asked once when the chat model or an AI job's model refuses a
   * request under its own policy or is unavailable, one row per OpenRouter
   * family; none selected is off. Absent on a custom endpoint.
   */
  fallbackModels: Schema.optionalKey(Schema.Array(ModelChoice)),
  /** Today's spend as the ledger counts it against the limit: reported costs, plus calls under way or of unknown cost at their reserved amount. */
  spentTodayUsd: Schema.Number,
  /** The daily limit the owner set, for today and later days. `NO_LIMIT_USD` or more is no limit. */
  capUsd: Schema.Number,
  /** Today's limit: the daily limit plus any "Allow $1 more". */
  limitTodayUsd: Schema.Number,
  /** What topic art, titles, Home and the send checks spent today, counted the same way. */
  backgroundTodayUsd: Schema.Number,
  /** Their share of today's limit: half, so Juno chats always keep the rest. */
  backgroundLimitUsd: Schema.Number,
  /** Codex on this Mac: not installed, signed out, or ready with its version. */
  codex: Schema.Union([
    Schema.TaggedStruct('missing', {}),
    Schema.TaggedStruct('signedOut', {}),
    Schema.TaggedStruct('ready', { version: Schema.String }),
  ]),
  /** `rejected`: the provider refused the key on the last call. */
  openRouterKey: Schema.Literals(['missing', 'set', 'rejected']),
  /** The active provider (main's `ProviderState` says what is set up). Absent means OpenRouter. */
  provider: Schema.optionalKey(Schema.Literals(['openrouter', 'custom'])),
  /** The custom endpoint refused its key on the last call. */
  customKeyRejected: Schema.optionalKey(Schema.Literal(true)),
  /**
   * The custom endpoint did not list its models, so the chat model is typed
   * in (`chatModels` holds the typed one, if any). Compaction uses the chat
   * model on a custom endpoint.
   */
  modelTyped: Schema.optionalKey(Schema.Literal(true)),
  /** The chat model reports no prices: it counts as $0 against the cap, which cannot track it. */
  spendUntracked: Schema.optionalKey(Schema.Literal(true)),
  /** The owner's rules, one line each. They can only tighten tiers. */
  rules: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
  paused: Schema.Boolean,
  backupFolder: Schema.String,
  lastBackupAt: Schema.optionalKey(Schema.Number),
  ownership: Ownership,
  /** When the recovery phrase was last exported. Absent until the owner exports it. */
  recoveryPhraseExportedAt: Schema.optionalKey(Schema.Number),
  /** "Removal pending: 1 copy in a running job", with the job to stop. */
  removalPending: Schema.optionalKey(Schema.Struct({ copies: Schema.Int, jobId: JobId })),
})
export type JunoSettingsPage = typeof JunoSettingsPage.Type
