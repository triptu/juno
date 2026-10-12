/**
 * The engine's line to its host (main) for everything that is not a port:
 * secrets, sign-in, the socket handshake, cookies (architecture 2.4).
 *
 * `Host` is the plain shape the Electron entry builds from `parentPort` and
 * tests build with `memoryHost()`. The engine never imports Electron.
 * `HostLink` wraps it as a service: `send` one message, read `messages` as a
 * stream, or `request` an answer by id.
 */
import { Context, Effect, Fiber, Layer, PubSub, Ref, Scope, Stream } from 'effect'
import type { EngineToMain, MainToEngine } from '@juno/contract'

export interface Host {
  readonly send: (message: EngineToMain) => void
  /** Calls `f` for every message from main, including any that arrived before. Returns an unsubscribe. */
  readonly onMessage: (f: (message: MainToEngine) => void) => () => void
}

/** A host for tests: messages the engine sends land in `fromEngine`; `deliver` sends one to the engine. */
export interface MemoryHost extends Host {
  readonly fromEngine: Array<EngineToMain>
  readonly deliver: (message: MainToEngine) => void
  /** Registers a responder; it sees every message the engine sends. */
  readonly onEngine: (f: (message: EngineToMain) => void) => () => void
}

export function memoryHost(): MemoryHost {
  const listeners = new Set<(message: MainToEngine) => void>()
  const engineListeners = new Set<(message: EngineToMain) => void>()
  const pending: Array<MainToEngine> = []
  const fromEngine: Array<EngineToMain> = []
  return {
    fromEngine,
    send: (message) => {
      fromEngine.push(message)
      for (const f of engineListeners) f(message)
    },
    onMessage: (f) => {
      listeners.add(f)
      for (const message of pending.splice(0)) f(message)
      return () => {
        listeners.delete(f)
      }
    },
    deliver: (message) => {
      if (listeners.size === 0) pending.push(message)
      else for (const f of listeners) f(message)
    },
    onEngine: (f) => {
      engineListeners.add(f)
      return () => {
        engineListeners.delete(f)
      }
    },
  }
}

/** A host with no stored session and nothing else to say: for engine tests that never sign in. */
export const silentHost = (): Host => {
  const host = memoryHost()
  host.onEngine((message) => {
    if (message._tag === 'requestSecrets') host.deliver({ _tag: 'secrets', secrets: null })
  })
  return host
}

export type HandshakeAnswer = Extract<MainToEngine, { _tag: 'handshake' }>

export class HostLink extends Context.Service<
  HostLink,
  {
    readonly send: (message: EngineToMain) => Effect.Effect<void>
    /** Every message from main from the moment of subscription. Subscribe before sending the request it answers. */
    readonly messages: Effect.Effect<Stream.Stream<MainToEngine>, never, Scope.Scope>
    /** Asks main what the socket upgrade needs for `url`. */
    readonly handshake: (url: string) => Effect.Effect<HandshakeAnswer>
  }
>()('juno/engine/HostLink') {
  static readonly layer = (host: Host): Layer.Layer<HostLink> =>
    Layer.effect(
      HostLink,
      Effect.gen(function* () {
        const pubsub = yield* PubSub.unbounded<MainToEngine>()
        const nextId = yield* Ref.make(1)
        const scope = yield* Effect.scope
        const unsubscribe = host.onMessage((message) => {
          PubSub.publishUnsafe(pubsub, message)
        })
        yield* Scope.addFinalizer(scope, Effect.sync(unsubscribe))

        const messages = Effect.map(PubSub.subscribe(pubsub), Stream.fromSubscription)

        const handshake = (url: string) =>
          Effect.scoped(
            Effect.gen(function* () {
              const id = yield* Ref.getAndUpdate(nextId, (n) => n + 1)
              const stream = yield* messages
              const answer = yield* Effect.forkScoped(
                Stream.runHead(Stream.filter(stream, (m): m is HandshakeAnswer => m._tag === 'handshake' && m.id === id)),
              )
              host.send({ _tag: 'handshake', id, url })
              const value = yield* Fiber.join(answer)
              if (value._tag === 'None') return yield* Effect.die(new Error('host link closed during handshake'))
              return value.value
            }),
          )

        return HostLink.of({
          send: (message) => Effect.sync(() => host.send(message)),
          messages,
          handshake,
        })
      }),
    )
}
