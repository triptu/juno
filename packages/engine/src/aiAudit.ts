/**
 * The AI activity log (Settings › Juno › AI activity): every model call the
 * engine or the agent made, and every one the cap, a missing key or AI
 * assist refused, in the open workspace's `user.db` (`ai_calls`).
 *
 * `record` only puts the call on an in-memory queue, so it never waits on
 * the store; one fiber writes what is queued in one transaction and trims
 * the table to the newest `KEEP` rows in it. A refusal that repeats the
 * newest row of its feature (same outcome, kind and model) adds to that
 * row's count instead of a new row, so a job blocked every 30 s does not
 * push everything else out. A record made with no workspace open is
 * dropped. Never prompt or response text: see `HostAiCall`.
 */
import type { HostAiCall } from '@juno/agent-contract'
import { Invalidation, keys, StoreWriter, transaction } from '@juno/store'
import { Context, Effect, Layer, Queue } from 'effect'
import { Workspace } from './workspace'

/** Rows kept per workspace. */
export const KEEP = 500
/** Calls held in memory while the store is busy; more than this are dropped, oldest first. */
const QUEUE_CAPACITY = 1000
/** An error's text is cut here. */
const MESSAGE_CHARS = 300

/**
 * Removes anything shaped like an API key or a bearer token from an error's
 * text, and the part of the input a moderation error quotes back
 * (OpenRouter's `flagged_input`), and cuts it short.
 */
export const cleanMessage = (text: string): string =>
  text
    .replace(/(\\?"flagged_input\\?"\s*:\s*)\\?"(?:[^"\\]|\\.)*?\\?"/g, '$1"[removed]"')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[key]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [key]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_CHARS)

export class AiAudit extends Context.Service<AiAudit, {
  /** Queues one call for the log. Returns at once and never fails. */
  readonly record: (call: HostAiCall) => Effect.Effect<void>
}>()('juno/engine/AiAudit') {
  static readonly layer: Layer.Layer<AiAudit, never, Workspace> = Layer.effect(AiAudit, Effect.gen(function* () {
    const workspace = yield* Workspace
    const queue = yield* Queue.sliding<HostAiCall>(QUEUE_CAPACITY)

    const write = (call: HostAiCall) => Effect.gen(function* () {
      const sql = yield* StoreWriter
      if (call.outcome !== 'ok') {
        const last = (yield* sql<{ id: number; outcome: string; kind: string; model: string; subject_id: string }>`SELECT id, outcome, kind, model, subject_id
          FROM ai_calls WHERE feature = ${call.feature} AND source = ${sourceOf(call)} ORDER BY id DESC LIMIT 1`)[0]
        if (last !== undefined && last.outcome === call.outcome && last.kind === call.kind && last.model === call.model && call.outcome === 'blocked') {
          const subject = last.subject_id === call.subjectId ? call.subjectId : ''
          yield* sql`UPDATE ai_calls SET repeats = repeats + 1, last_at = ${call.at}, subject_id = ${subject},
            subject_kind = CASE WHEN ${subject} = '' THEN '' ELSE subject_kind END WHERE id = ${last.id}`
          return
        }
      }
      yield* sql`INSERT INTO ai_calls (at, last_at, source, feature, subject_kind, subject_id, provider, model, outcome, kind, message, duration_ms,
          input_tokens, output_tokens, cost_usd, summary)
        VALUES (${call.at}, ${call.at}, ${sourceOf(call)}, ${call.feature}, ${call.subjectKind}, ${call.subjectId}, ${call.provider}, ${call.model},
          ${call.outcome}, ${call.kind}, ${cleanMessage(call.message)}, ${Math.max(0, Math.round(call.durationMs))},
          ${call.inputTokens}, ${call.outputTokens}, ${call.costUsd}, ${call.summary.slice(0, 80)})`
    })

    yield* Effect.forkScoped(Effect.forever(Effect.gen(function* () {
      const calls = yield* Queue.takeAll(queue)
      const open = yield* workspace.current
      if (open === undefined) return
      yield* transaction(Effect.gen(function* () {
        for (const call of calls) yield* write(call)
        const sql = yield* StoreWriter
        yield* sql`DELETE FROM ai_calls WHERE id <= (SELECT id FROM ai_calls ORDER BY id DESC LIMIT 1 OFFSET ${KEEP})`
        yield* (yield* Invalidation).invalidate(keys.aiCalls)
      })).pipe(
        Effect.provide(open.context),
        Effect.catch((error) => Effect.logWarning('ai activity: a write failed', error)),
      )
    })))

    return AiAudit.of({ record: (call) => Effect.sync(() => { Queue.offerUnsafe(queue, call) }) })
  }))
}

/** The agent's features are its own; everything else is the engine's. */
const AGENT_FEATURES = new Set(['chat', 'subagent', 'compaction'])
const sourceOf = (call: HostAiCall): 'agent' | 'engine' => (AGENT_FEATURES.has(call.feature) ? 'agent' : 'engine')
