/**
 * Engine routes: process-level status and a ping for diagnostics.
 *
 * Route files follow this shape. One `RpcGroup` per feature, exported as
 * `<Feature>Routes`, with the view models it needs next to it. Add the group
 * to `routes/index.ts`.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { liveValueRoute } from '../live'

export const EnginePhase = Schema.Union([
  Schema.TaggedStruct('first-run', {}),
  /** `first`: the first sync of this workspace (a cold boot); the sidebar shows its progress. */
  Schema.TaggedStruct('booting', { first: Schema.optionalKey(Schema.Boolean) }),
  Schema.TaggedStruct('catching-up', { done: Schema.Int, total: Schema.Int, first: Schema.optionalKey(Schema.Boolean) }),
  Schema.TaggedStruct('live', {}),
  Schema.TaggedStruct('offline', {}),
  Schema.TaggedStruct('rate-limited', { until: Schema.Number }),
  Schema.TaggedStruct('session-expired', {}),
])
export type EnginePhase = typeof EnginePhase.Type

export const EngineStatus = Schema.Struct({
  phase: EnginePhase,
  /** Epoch milliseconds when the engine process started. Changes on restart. */
  startedAt: Schema.Number,
  /** A sync cycle (a boot, catch-up or sweep, with its follow pass) is running. Slack calls and row changes may still come. */
  syncing: Schema.Boolean,
})
export type EngineStatus = typeof EngineStatus.Type

/** The engine's phase. Emits once at subscribe time and then on every change of the phase or of `syncing`. */
export const engineStatus = liveValueRoute('engine.status', { value: EngineStatus })

/**
 * A round trip for diagnostics. Answers `n + 1` and the engine's clock. Under
 * `EngineConfig.e2e`, a negative `n` is a defect, so tests can check that one
 * failed request does not close the port.
 */
export const enginePing = Rpc.make('engine.ping', {
  payload: { n: Schema.Int },
  success: Schema.Struct({ pong: Schema.Int, at: Schema.Number }),
})

export const OutboxCount = Schema.Struct({
  kind: Schema.Literals(['post', 'mark', 'edit', 'delete', 'react']),
  state: Schema.Literals(['queued', 'sending', 'unknown', 'failed', 'retrying', 'waiting']),
  count: Schema.Int,
})
export const engineOutbox = Rpc.make('engine.outbox', {
  success: Schema.NullOr(Schema.Array(OutboxCount)),
})
export const EngineRoutes = RpcGroup.make(engineStatus, enginePing, engineOutbox)
