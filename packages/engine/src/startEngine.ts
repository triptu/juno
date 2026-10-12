/**
 * Starts the engine on a transport. Electron calls this from the utility
 * process entry; tests call it from Node with a `memoryTransport`.
 *
 * Startup order follows performance 2.1: the services and the RPC server come
 * up first, so the first live query is answered from local state before any
 * network work starts. Boot work (later milestones) is forked after `ready`.
 */
import { Effect, Exit, Layer, Scope } from 'effect'
import type { EngineConfig as Config } from '@juno/contract'
import { EngineConfig } from './config'
import { Handlers, Services } from './layer'
import { protocolServer } from './protocol/server'
import type { Transport } from './protocol/transport'
import { Status } from './status/Status'

export interface EngineHandle {
  readonly config: Config
  /** Closes every port and releases every service. */
  readonly stop: () => Promise<void>
}

export function startEngine(transport: Transport, config: Config): Promise<EngineHandle> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const app = protocolServer(transport).pipe(
        Layer.provide(Handlers),
        Layer.provideMerge(Services),
        Layer.provide(EngineConfig.layer(config)),
      )
      // A failed build must not leak what was already acquired.
      const context = yield* Layer.buildWithScope(app, scope).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))
      // Nothing to boot yet: the engine is live as soon as it serves.
      yield* Status.use((status) => status.setPhase({ _tag: 'live' })).pipe(Effect.provideContext(context))
      return { config, stop: () => Effect.runPromise(Scope.close(scope, Exit.void)) }
    }),
  )
}
