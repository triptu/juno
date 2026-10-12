/**
 * Starts the engine on a transport. Electron calls this from the utility
 * process entry; tests call it from Node with a `memoryTransport`.
 *
 * Startup order follows performance 2.1: the services and the RPC server come
 * up first, so the first live query is answered from local state before any
 * network work starts. Boot work (later milestones) is forked after `ready`.
 */
import { Effect, Exit, Layer, Scope } from 'effect'
import type { EngineConfig } from '@juno/contract'
import { Handlers, Services } from './layer'
import { protocolServer } from './protocol/server'
import type { Transport } from './protocol/transport'
import { Status } from './status/Status'

export interface EngineHandle {
  readonly config: EngineConfig
  readonly stop: () => Promise<void>
}

export async function startEngine(transport: Transport, config: EngineConfig): Promise<EngineHandle> {
  const scope = await Effect.runPromise(Scope.make())
  const services = Layer.provideMerge(Services, Layer.empty)
  const app = protocolServer(transport).pipe(Layer.provide(Handlers), Layer.provideMerge(services))
  const context = await Effect.runPromise(Layer.buildWithScope(app, scope))
  // Nothing to boot yet: the engine is live as soon as it serves.
  await Effect.runPromise(Status.use((status) => status.setPhase({ _tag: 'live' })).pipe(Effect.provideContext(context)))
  return {
    config,
    stop: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
