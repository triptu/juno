/**
 * The client side of the AgentHost port: an `effect/workers` platform whose
 * one "worker" is the current host port, the same shape as the renderer's
 * engine client (`packages/state/src/transport.ts`, ADR 0009).
 *
 * `acquire` gives the first port and, after a close (the host restarted), the
 * next one. The pool retries the spawn and buffers requests meanwhile.
 */
import { Deferred, Effect, Layer, Scope } from 'effect'
import { RpcClient } from 'effect/rpc'
import { Worker, WorkerError } from 'effect/workers'

/** A port to the host. The agent entry adapts Electron's `MessagePortMain`; tests adapt a Node `MessagePort`. */
export interface HostPort {
  readonly postMessage: (message: unknown) => void
  readonly onMessage: (f: (message: unknown) => void) => void
  readonly onClose: (f: () => void) => void
  readonly close: () => void
}

export interface HostConnection {
  /** Resolves with the next port to the host. */
  readonly acquire: () => Promise<HostPort>
}

const platform = Worker.makePlatform<HostConnection>()({
  setup: ({ worker, scope }) =>
    Effect.gen(function* () {
      const port = yield* Effect.tryPromise({
        try: worker.acquire,
        catch: (cause) => new WorkerError.WorkerError({ reason: new WorkerError.WorkerSpawnError({ message: 'could not get a host port', cause }) }),
      })
      yield* Scope.addFinalizer(scope, Effect.sync(() => port.close()))
      return { postMessage: (message: unknown) => port.postMessage(message), port }
    }),
  listen: ({ port, emit, deferred }) =>
    Effect.sync(() => {
      port.port.onMessage(emit)
      port.port.onClose(() => {
        Deferred.doneUnsafe(
          deferred,
          Effect.fail(new WorkerError.WorkerError({ reason: new WorkerError.WorkerReceiveError({ message: 'host port closed' }) })),
        )
      })
    }),
})

/** One port carries every request, so a pool item's concurrency is effectively unlimited. */
const IN_FLIGHT_PER_PORT = 1 << 20

export function hostProtocol(connection: HostConnection): Layer.Layer<RpcClient.Protocol, WorkerError.WorkerError> {
  return RpcClient.layerProtocolWorker({ size: 1, concurrency: IN_FLIGHT_PER_PORT }).pipe(
    Layer.provide(Layer.mergeAll(Layer.succeed(Worker.WorkerPlatform, platform), Worker.layerSpawner(() => connection))),
  )
}
