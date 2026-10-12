/**
 * The engine's configuration as a service, built from the `EngineConfig`
 * main sends over parentPort (or a test passes to `startEngine`).
 */
import { Context, Layer } from 'effect'
import type { EngineConfig as Config } from '@juno/contract'

export class EngineConfig extends Context.Service<EngineConfig, Config>()('juno/engine/EngineConfig') {
  static readonly layer = (config: Config): Layer.Layer<EngineConfig> => Layer.succeed(EngineConfig, config)
}
