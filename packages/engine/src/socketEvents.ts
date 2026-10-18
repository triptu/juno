/**
 * Socket events for engine services (architecture 6, 15 "Seams").
 *
 * A service subscribes in its own layer with a session start: an effect that
 * runs once for each running sync, in that sync's scope, with its Slack
 * client and the open workspace's store, and returns the listener for that
 * sync's events. `SyncRunner` attaches each sync and passes the publisher to
 * `runSync` as `onEvent`, so it does not know who listens.
 *
 * Each subscriber gets every event after the sync has stored it, in socket
 * order, one at a time, through a queue of its own that one fiber drains.
 * The queue holds `CAPACITY` events; when a subscriber falls that far behind,
 * the sync waits for it (with a warning) rather than drop an event. A
 * subscriber's queue and fiber live in a child of the sync's scope, so the
 * events of an ended session are never delivered to the next one, and they
 * close as soon as the subscriber's own scope does.
 */
import type { Me } from '@juno/domain'
import type { SocketEvent } from '@juno/slack'
import { Context, Effect, Exit, Layer, Queue, Scope, Semaphore } from 'effect'
import type { SlackServices } from './session/Session'
import type { StoreServices } from './workspace'

/** How many events one subscriber may fall behind before the sync waits for it. */
export const CAPACITY = 1024

/** Handles one event of the session it was started for. Failures are logged and the next event follows. */
export type SocketListener = (event: SocketEvent, me: Me) => Effect.Effect<void>

/** What a session start may use: the running session's Slack client, the open workspace's store, and the sync's scope. */
export type SessionServices = SlackServices | StoreServices | Scope.Scope

export type SessionStart = Effect.Effect<SocketListener, never, SessionServices>

interface Delivery {
  readonly queue: Queue.Queue<readonly [SocketEvent, Me]>
  readonly scope: Scope.Closeable
}

interface Attached {
  readonly context: Context.Context<SessionServices>
  readonly scope: Scope.Scope
  readonly deliveries: Map<object, Delivery>
}

export class SocketEvents extends Context.Service<SocketEvents, {
  /** Starts `start` for the running sync, if any, and for every later one, until the calling scope closes. */
  readonly subscribe: (start: SessionStart) => Effect.Effect<void, never, Scope.Scope>
  /** For `SyncRunner`: starts every subscriber in the sync's scope and returns the publisher for `runSync`'s `onEvent`. */
  readonly attach: Effect.Effect<SocketListener, never, SessionServices>
}>()('juno/engine/SocketEvents') {
  static readonly layer = Layer.effect(SocketEvents, Effect.gen(function* () {
    // Serializes subscribing, attaching and their ends, so each pair of subscriber and session starts once.
    const lock = yield* Semaphore.make(1)
    const subscribers = new Map<object, SessionStart>()
    let current: Attached | undefined

    const start = (attached: Attached, key: object, sessionStart: SessionStart) =>
      Effect.flatMap(Scope.fork(attached.scope, 'sequential'), (scope) => Effect.gen(function* () {
        const queue = yield* Queue.bounded<readonly [SocketEvent, Me]>(CAPACITY)
        // Ends a publisher waiting on a full queue (its offer returns false) once this delivery closes.
        yield* Scope.addFinalizer(scope, Queue.shutdown(queue))
        const listener = yield* sessionStart.pipe(Effect.provideService(Scope.Scope, scope), Effect.provideContext(attached.context))
        yield* Effect.forkIn(
          Effect.forever(Effect.flatMap(Queue.take(queue), ([event, me]) =>
            listener(event, me).pipe(Effect.catchCause((cause) => Effect.logWarning('socket events: a subscriber failed on an event', { cause }))))),
          scope,
        )
        attached.deliveries.set(key, { queue, scope })
      }).pipe(Effect.catchCause((cause) => Effect.logError('socket events: a subscriber did not start', { cause }).pipe(Effect.andThen(Scope.close(scope, Exit.void))))))

    const stop = (attached: Attached, key: object) =>
      Effect.suspend(() => {
        const delivery = attached.deliveries.get(key)
        attached.deliveries.delete(key)
        return delivery === undefined ? Effect.void : Scope.close(delivery.scope, Exit.void)
      })

    const offer = (queue: Delivery['queue'], item: readonly [SocketEvent, Me]) =>
      Queue.offerUnsafe(queue, item)
        ? Effect.void
        : Effect.logWarning('socket events: a subscriber is behind; the sync waits for it').pipe(Effect.andThen(Queue.offer(queue, item)), Effect.asVoid)

    const subscribe = (sessionStart: SessionStart) =>
      Effect.gen(function* () {
        const key = {}
        yield* Effect.acquireRelease(
          lock.withPermits(1)(Effect.suspend(() => {
            subscribers.set(key, sessionStart)
            return current === undefined ? Effect.void : start(current, key, sessionStart)
          })),
          () => lock.withPermits(1)(Effect.suspend(() => {
            subscribers.delete(key)
            return current === undefined ? Effect.void : stop(current, key)
          })),
        )
      })

    const attach = Effect.gen(function* () {
      const attached: Attached = { context: yield* Effect.context<SessionServices>(), scope: yield* Scope.Scope, deliveries: new Map() }
      yield* Effect.acquireRelease(
        lock.withPermits(1)(Effect.gen(function* () {
          current = attached
          for (const [key, sessionStart] of subscribers) yield* start(attached, key, sessionStart)
        })),
        // The deliveries close with the sync's scope.
        () => lock.withPermits(1)(Effect.sync(() => {
          if (current === attached) current = undefined
        })),
      )
      const publish: SocketListener = (event, me) =>
        Effect.suspend(() => Effect.forEach([...attached.deliveries.values()], ({ queue }) => offer(queue, [event, me]), { discard: true }))
      return publish
    })

    return SocketEvents.of({ subscribe, attach })
  }))
}
