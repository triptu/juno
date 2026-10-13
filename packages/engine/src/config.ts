/**
 * The engine's configuration as a service, built from the `EngineConfig`
 * main sends over parentPort (or a test passes to `startEngine`).
 */
import { Context, Layer } from 'effect'
import type { SyncConfigShape } from '@juno/sync'
import type { EngineConfig as Config } from '@juno/contract'

export class EngineConfig extends Context.Service<EngineConfig, Config>()('juno/engine/EngineConfig') {
  static readonly layer = (config: Config): Layer.Layer<EngineConfig> => Layer.succeed(EngineConfig, config)
}

/** Host controls for observing sync cycles and overriding their schedule. */
export interface SyncControlOptions {
  readonly config?: Partial<SyncConfigShape>
  readonly onCycle?: (event: 'started' | 'finished') => void
}

export class SyncControl extends Context.Reference<SyncControlOptions>('juno/engine/SyncControl', {
  defaultValue: () => ({}),
}) {}
