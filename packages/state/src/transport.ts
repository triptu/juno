/**
 * The renderer side of the port protocol (ADR 0009): an `effect/workers`
 * `WorkerPlatform` whose single "worker" is the current `MessagePort`.
 *
 * `acquire` is called for the first connection and again after the port's
 * `close` event (the engine died, or the renderer was given a new port). The
 * worker pool in `RpcClient.layerProtocolWorker` retries the spawn after 1 s
 * and buffers requests sent in the meantime. In-flight requests at the time
 * of the close fail with `RpcClientError`; live query atoms retry.
 *
 * Nothing here touches `window`, so the same code runs over a Node
 * `MessageChannel` in tests.
 */
import { Deferred, Effect, Layer, Scope } from 'effect'
import { RpcClient } from 'effect/rpc'
import { Worker, WorkerError } from 'effect/workers'

/** The DOM `MessagePort` surface used here. Node's `worker_threads` port has the same one. */
export interface PortLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'close', listener: () => void): void
  start?(): void
  close(): void
}

export interface PortConnection {
  /** Gets a fresh port. Called once per connection attempt. */
  readonly acquire: () => Promise<PortLike>
  /** Called when a port is open and when it closes. */
  readonly onState?: (state: 'connected' | 'disconnected') => void
}

const platform = Worker.makePlatform<PortConnection>()({
  setup: ({ worker, scope }) =>
    Effect.gen(function* () {
      const port = yield* Effect.tryPromise({
        try: worker.acquire,
        catch: (cause) => new WorkerError.WorkerError({ reason: new WorkerError.WorkerSpawnError({ message: 'could not get an engine port', cause }) }),
      })
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          worker.onState?.('disconnected')
          port.close()
        }),
      )
      return { postMessage: (message: unknown) => port.postMessage(message), port, connection: worker }
    }),
  listen: ({ port, emit, deferred }) =>
    Effect.sync(() => {
      port.port.addEventListener('message', (event) => emit(event.data))
      port.port.addEventListener('close', () => {
        Deferred.doneUnsafe(
          deferred,
          Effect.fail(new WorkerError.WorkerError({ reason: new WorkerError.WorkerReceiveError({ message: 'engine port closed' }) })),
        )
      })
      port.port.start?.()
      port.connection.onState?.('connected')
    }),
})

/**
 * The pool's per-worker concurrency is the number of in-flight requests one
 * port may carry; the default of 1 would make every live query block the
 * next command. There is no useful limit here: one port carries everything.
 */
const IN_FLIGHT_PER_PORT = 1 << 20

/** A client `Protocol` for the engine: this one, or the web shell's socket (`socket.ts`). */
export type EngineProtocol = Layer.Layer<RpcClient.Protocol, WorkerError.WorkerError>

/** A client `Protocol` over one port at a time. */
export function portProtocol(connection: PortConnection): EngineProtocol {
  return RpcClient.layerProtocolWorker({ size: 1, concurrency: IN_FLIGHT_PER_PORT }).pipe(
    Layer.provide(Layer.mergeAll(Layer.succeed(Worker.WorkerPlatform, platform), Worker.layerSpawner(() => connection))),
  )
}
