/**
 * Messages around the port, not on it.
 *
 * The port itself carries `effect/rpc` (ADR 0009). These schemas cover how a
 * port reaches each side and what main and the engine say to each other over
 * `process.parentPort`.
 */
import { Schema } from 'effect'

/** What main sends the engine once, before any port, over parentPort. */
export const EngineConfig = Schema.Struct({
  /** Electron's userData path. Databases live under it. */
  userData: Schema.String,
  /** True under Playwright: plaintext secrets, fake AI, test hooks. */
  e2e: Schema.Boolean,
})
export type EngineConfig = typeof EngineConfig.Type

/** main -> engine over parentPort. A `port` message carries the port in `ports[0]`. */
export const MainToEngine = Schema.Union([
  Schema.TaggedStruct('config', { config: EngineConfig }),
  Schema.TaggedStruct('port', {}),
])
export type MainToEngine = typeof MainToEngine.Type

/** engine -> main over parentPort. */
export const EngineToMain = Schema.Union([
  /** The engine is serving; main may hand it ports. */
  Schema.TaggedStruct('ready', {}),
])
export type EngineToMain = typeof EngineToMain.Type

/**
 * The preload forwards a port to the page with `window.postMessage(message,
 * '*', ports)`. The page accepts it only when `event.source === window` and
 * the data matches this schema.
 */
export const PortHandoff = Schema.TaggedStruct('juno.enginePort', {})
export type PortHandoff = typeof PortHandoff.Type
