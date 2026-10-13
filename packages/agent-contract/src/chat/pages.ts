/**
 * The pages behind the Juno header menu (plan v3 §13.3): Scheduled, What
 * Juno remembers, Memory of this chat, Activity, Connections and Settings ›
 * Juno. Rows only; the containers wire the edits.
 */
import { Schema } from 'effect'
import { Deliver } from './cards'
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
})
export type ActivityAction = typeof ActivityAction.Type

export const ActivityRun = Schema.Struct({
  id: RunId,
  /** Who asked: "You", a schedule's name, a job's title. */
  who: Schema.String,
  at: Schema.Number,
  /** "Replied", "Stopped", "Interrupted", "Stayed quiet", "Blocked". */
  outcome: Schema.String,
  actions: Schema.Array(ActivityAction),
  /** The folded read line: "Read 3 topics, looked back 4 times". */
  reads: Schema.optionalKey(Schema.String),
  /** The run was tainted by untrusted content from here on. */
  tainted: Schema.Boolean,
})
export type ActivityRun = typeof ActivityRun.Type

export const ActivityPage = Schema.Struct({ runs: Schema.Array(ActivityRun), moreAbove: Schema.Boolean })
export type ActivityPage = typeof ActivityPage.Type

/* Connections -------------------------------------------------------------- */

export const ConnectionState = Schema.Literals(['off', 'connecting', 'ready', 'degraded', 'needsSignIn', 'error'])
export type ConnectionState = typeof ConnectionState.Type

export const DiscoveredTool = Schema.Struct({
  name: Schema.String,
  /** Tier 0 reads need no click; Tier 3 is a card every time. */
  tier: Schema.Literals([0, 3]),
  /** The server's hint, shown and never trusted. */
  hint: Schema.optionalKey(Schema.String),
  /** On the server's default allowlist. */
  allowlisted: Schema.Boolean,
  /** Its schema changed since review: dropped to Tier 3. */
  changed: Schema.optionalKey(Schema.Literal(true)),
})
export type DiscoveredTool = typeof DiscoveredTool.Type

export const ConnectionRow = Schema.Struct({
  id: ConnectionId,
  label: Schema.String,
  state: ConnectionState,
  /** What is wrong, in words, when degraded or in error. */
  detail: Schema.optionalKey(Schema.String),
  /** The address in use, shown for T3 Code. */
  address: Schema.optionalKey(Schema.String),
  tools: Schema.Array(DiscoveredTool),
  enabled: Schema.Boolean,
})
export type ConnectionRow = typeof ConnectionRow.Type

export const ConnectionsPage = Schema.Struct({ connections: Schema.Array(ConnectionRow) })
export type ConnectionsPage = typeof ConnectionsPage.Type

/* Settings › Juno ---------------------------------------------------------- */

/** One row of the model picker: a family resolved to today's newest model. */
export const ModelChoice = Schema.Struct({
  family: Schema.String,
  /** "Claude Sonnet 5.5". Absent when the catalogue has no model that fits. */
  resolved: Schema.optionalKey(Schema.String),
  provider: Schema.Literals(['openrouter', 'codex']),
  /** "$3 / $15 per million tokens". */
  price: Schema.optionalKey(Schema.String),
  selected: Schema.Boolean,
})
export type ModelChoice = typeof ModelChoice.Type

export const JunoSettingsPage = Schema.Struct({
  chatModels: Schema.Array(ModelChoice),
  compactionModels: Schema.Array(ModelChoice),
  spentTodayUsd: Schema.Number,
  capUsd: Schema.Number,
  /** Codex on this Mac: not installed, signed out, or ready with its version. */
  codex: Schema.Union([
    Schema.TaggedStruct('missing', {}),
    Schema.TaggedStruct('signedOut', {}),
    Schema.TaggedStruct('ready', { version: Schema.String }),
  ]),
  openRouterKey: Schema.Literals(['missing', 'set']),
  /** The owner's rules, one line each. They can only tighten tiers. */
  rules: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
  paused: Schema.Boolean,
  backupFolder: Schema.String,
  lastBackupAt: Schema.optionalKey(Schema.Number),
  /** "Removal pending: 1 copy in a running job", with the job to stop. */
  removalPending: Schema.optionalKey(Schema.Struct({ copies: Schema.Int, jobId: JobId })),
})
export type JunoSettingsPage = typeof JunoSettingsPage.Type
