/**
 * Adapts a `Transport` to `effect/workers`' `WorkerRunnerPlatform`, which is
 * what `RpcServer.layerProtocolWorkerRunner` consumes (ADR 0009).
 *
 * Wire format, fixed by `effect/workers`: a client sends `[0, message]` for a
 * request and `[1]` to close; the runner sends `[0]` once when a port is
 * attached (ready) and `[1, message]` for every response. Each port is one
 * client id; closing a port reports it on `disconnects`, and the RPC server
 * then interrupts every fiber that belongs to that client. When the runner
 * itself stops (engine shutdown), every open port is closed.
 */
import { Effect, FiberSet, Layer, Queue } from 'effect'
import { WorkerRunner, type WorkerError } from 'effect/workers'
import type { EnginePort, Transport } from './transport'

type Inbound<I> = readonly [request: 0, I] | readonly [close: 1]

export function runnerPlatform(transport: Transport): Layer.Layer<WorkerRunner.WorkerRunnerPlatform> {
  return Layer.succeed(
    WorkerRunner.WorkerRunnerPlatform,
    WorkerRunner.WorkerRunnerPlatform.of({
      start: <O, I>() =>
        Effect.gen(function* () {
          const disconnects = yield* Queue.make<number>()
          const ports = new Map<number, EnginePort>()
          let nextId = 0

          const run = <A, E, R>(handler: (portId: number, message: I) => Effect.Effect<A, E, R> | void) =>
            Effect.gen(function* () {
              const fibers = yield* FiberSet.make<A, E>()
              const fork = yield* FiberSet.runtime(fibers)<R>()
              const attach = (port: EnginePort) => {
                const id = nextId++
                ports.set(id, port)
                port.onMessage((data) => {
                  const message = data as Inbound<I>
                  if (message[0] === 0) {
                    const result = handler(id, message[1])
                    if (result) fork(result)
                  } else {
                    port.close()
                  }
                })
                port.onClose(() => {
                  if (!ports.delete(id)) return
                  Queue.offerUnsafe(disconnects, id)
                })
                port.postMessage([0])
              }
              const unsubscribe = transport.ports(attach)
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  unsubscribe()
                  for (const port of ports.values()) port.close()
                  ports.clear()
                }),
              )
              yield* Effect.never
            }).pipe(Effect.scoped) as Effect.Effect<void, WorkerError.WorkerError, R>

          const sendUnsafe = (portId: number, message: O) => {
            ports.get(portId)?.postMessage([1, message])
          }

          return {
            run,
            send: (portId: number, message: O) => Effect.sync(() => sendUnsafe(portId, message)),
            sendUnsafe,
            disconnects,
          } satisfies WorkerRunner.WorkerRunner<O, I>
        }),
    }),
  )
}
