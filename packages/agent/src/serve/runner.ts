/**
 * The renderer ports as an `effect/workers` runner platform, which
 * `RpcServer.layerProtocolWorkerRunner` serves `AgentRpcs` on. The same
 * adapter as the engine's (`packages/engine/src/protocol/runner.ts`, ADR
 * 0009); the agent may not import the engine, so it keeps its own copy.
 *
 * Wire format, fixed by `effect/workers`: a client sends `[0, message]` for a
 * request and `[1]` to close; the runner sends `[0]` once when a port is
 * attached and `[1, message]` for every response. Each port is one client;
 * a closed port ends that client's streams.
 */
import { Effect, FiberSet, Layer, Queue } from 'effect'
import { WorkerRunner, type WorkerError } from 'effect/workers'
import type { HostPort } from '../host/port'

/** Where renderer ports come from: main hands the agent one per renderer, and a new one after a reload. */
export interface RendererTransport {
  /** Calls `attach` for every port, now and later. Returns an unsubscribe. */
  readonly ports: (attach: (port: HostPort) => void) => () => void
}

/** Collects ports pushed in from outside. */
export function rendererPorts(): RendererTransport & { readonly add: (port: HostPort) => void } {
  const listeners = new Set<(port: HostPort) => void>()
  const pending: Array<HostPort> = []
  return {
    ports: (attach) => {
      listeners.add(attach)
      for (const port of pending.splice(0)) attach(port)
      return () => {
        listeners.delete(attach)
      }
    },
    add: (port) => {
      if (listeners.size === 0) pending.push(port)
      else for (const attach of listeners) attach(port)
    },
  }
}

type Inbound<I> = readonly [request: 0, I] | readonly [close: 1]

export function runnerPlatform(transport: RendererTransport): Layer.Layer<WorkerRunner.WorkerRunnerPlatform> {
  return Layer.succeed(
    WorkerRunner.WorkerRunnerPlatform,
    WorkerRunner.WorkerRunnerPlatform.of({
      start: <O, I>() =>
        Effect.gen(function* () {
          const disconnects = yield* Queue.make<number>()
          const ports = new Map<number, HostPort>()
          let nextId = 0

          const run = <A, E, R>(handler: (portId: number, message: I) => Effect.Effect<A, E, R> | void) =>
            Effect.gen(function* () {
              const fibers = yield* FiberSet.make<A, E>()
              const fork = yield* FiberSet.runtime(fibers)<R>()
              const attach = (port: HostPort) => {
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
