/**
 * Starts the engine on a transport. Electron calls this from the utility
 * process entry; tests call it from Node with a `memoryTransport`.
 *
 * Startup order follows performance 2.1: the services and the RPC server come
 * up first, so the first live query is answered from local state before any
 * network work starts. The session then asks main for the stored secrets and
 * verifies them in the background (`session/Session.ts`).
 *
 * The host supplies two seams the engine cannot own: a `Host` (parentPort in
 * Electron, `memoryHost()` in tests) and the `HttpTransport` for Slack
 * (`net.fetch` on the `persist:slack` session in Electron, Node `fetch` in
 * tests). Both default to the Node flavour so a bare `startEngine` still
 * serves.
 */
import { Context, Effect, Exit, Layer, Scope } from 'effect'
import type { EngineConfig as Config } from '@juno/contract'
import { HttpTransport } from '@juno/slack'
import { EngineConfig, SyncControl, type SyncControlOptions } from './config'
import { HostLink, silentHost, type Host } from './protocol/host'
import { Outbox } from './outbox'
import { Handlers, Services } from './layer'
import { protocolServer } from './protocol/server'
import type { Transport } from './protocol/transport'

export interface EngineHandle {
  readonly config: Config
  /** Closes every port and releases every service. */
  readonly stop: () => Promise<void>
  /** Waits for scheduled background command recoveries, including their local writes. */
  readonly commandIdle: () => Promise<void>
}

export interface EngineHostOptions {
  /** Optional cycle observer and sync schedule overrides, used by the test harness. */
  readonly sync?: SyncControlOptions
  readonly host?: Host
  /** The HTTP seam for Slack (ADR 0007). */
  readonly httpTransport?: Layer.Layer<HttpTransport>
}

export function startEngine(transport: Transport, config: Config, options: EngineHostOptions = {}): Promise<EngineHandle> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const app = protocolServer(transport).pipe(
        Layer.provide(Handlers),
        Layer.provideMerge(Services),
        Layer.provide(
          Layer.mergeAll(
            EngineConfig.layer(config),
            Layer.succeed(SyncControl, options.sync ?? {}),
            HostLink.layer(options.host ?? silentHost()),
            options.httpTransport ?? HttpTransport.nodeFetch(),
          ),
        ),
      )
      // A failed build must not leak what was already acquired.
      const context = yield* Layer.buildWithScope(app, scope).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))
      const outbox = Context.get(context, Outbox)
      return {
        config,
        stop: () => Effect.runPromise(Scope.close(scope, Exit.void)),
        commandIdle: () => Effect.runPromise(outbox.idle),
      }
    }),
  )
}
