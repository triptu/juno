/**
 * The AI activity log (Settings › AI activity): the newest model calls the
 * engine and the agent made, or were refused, kept in `user.db`
 * (`ai_calls`, 500 rows). Never prompt or response text.
 */
import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { liveValueRoute } from '../live'

export const AiCallOutcome = Schema.Literals(['ok', 'error', 'blocked', 'cancelled', 'timeout'])
export type AiCallOutcome = typeof AiCallOutcome.Type

export const AiCallRow = Schema.Struct({
  id: Schema.String,
  /** When the call started, in milliseconds. */
  at: Schema.Number,
  /** A refusal repeated with nothing between them is one row: the last time and the count. */
  lastAt: Schema.Number,
  repeats: Schema.Int,
  source: Schema.Literals(['engine', 'agent']),
  /** What the call was for: an engine task (`titleTopic`, `topicArt`, `topicArt.redraw`…) or the agent's `chat`, `subagent`, `compaction`. */
  feature: Schema.String,
  /** What it was about, with its name as it is now: a topic's title, a channel's label. '' kind for nothing in particular. */
  subject: Schema.Struct({ kind: Schema.String, id: Schema.String, name: Schema.String }),
  provider: Schema.String,
  model: Schema.String,
  outcome: AiCallOutcome,
  /** Why it was not ok, as a code (`no-key`, `cap`, `provider-error`…). '' when ok. */
  kind: Schema.String,
  /** An error's short text, never a prompt or an answer. */
  message: Schema.String,
  durationMs: Schema.Number,
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  /** Estimated from the provider's prices. Null when unknown. */
  costUsd: Schema.NullOr(Schema.Number),
  /** A short shape of the answer, such as "title, 6 words". */
  summary: Schema.String,
})
export type AiCallRow = typeof AiCallRow.Type

export const AiActivity = Schema.Struct({
  /** Newest first. */
  calls: Schema.Array(AiCallRow),
  /** The estimated cost of today's calls, from local midnight. */
  todayUsd: Schema.Number,
  todayCalls: Schema.Int,
})
export type AiActivity = typeof AiActivity.Type

export const aiActivity = liveValueRoute('ai.activity', { value: AiActivity })

export const AiRoutes = RpcGroup.make(aiActivity)
