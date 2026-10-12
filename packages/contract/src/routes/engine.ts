/**
 * Engine routes: process-level status and a ping for diagnostics.
 *
 * Route files follow this shape. One `RpcGroup` per feature, exported as
 * `<Feature>Routes`, with the view models it needs next to it. Add the group
 * to `routes/index.ts`.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { liveQuery } from '../live'

export const EnginePhase = Schema.Union([
  Schema.TaggedStruct('first-run', {}),
  Schema.TaggedStruct('booting', {}),
  Schema.TaggedStruct('catching-up', { done: Schema.Int, total: Schema.Int }),
  Schema.TaggedStruct('live', {}),
  Schema.TaggedStruct('offline', {}),
  Schema.TaggedStruct('rate-limited', { until: Schema.Number }),
  Schema.TaggedStruct('session-expired', {}),
])
export type EnginePhase = typeof EnginePhase.Type

export const EngineStatus = Schema.Struct({
  phase: EnginePhase,
  /** Milliseconds since the engine process started. */
  uptime: Schema.Number,
  /** Epoch milliseconds when the engine process started. Changes on restart. */
  startedAt: Schema.Number,
})
export type EngineStatus = typeof EngineStatus.Type

/** The engine's phase and uptime. Changes on every phase change and once a second. */
export const engineStatus = liveQuery('engine.status', { value: EngineStatus })

/** A round trip for diagnostics. Answers `n + 1` and the engine's clock. */
export const enginePing = Rpc.make('engine.ping', {
  payload: { n: Schema.Int },
  success: Schema.Struct({ pong: Schema.Int, at: Schema.Number }),
})

export const EngineRoutes = RpcGroup.make(engineStatus, enginePing)
