/**
 * Socket events for engine services (architecture 6, 15 "Seams").
 *
 * A service subscribes in its own layer with a session start: an effect that
 * runs once for each running sync, in that sync's scope, with its Slack
 * client and the open workspace's store, and returns the listener for that
 * sync's events. `SyncRunner` attaches each sync and passes the publisher to
 * `runSync` as `onEvent`, so it does not know who listens.
 *
 * Each subscriber gets the events after the sync's write attempt for each
 * (a write that failed is logged and the event still follows), in socket
 * order, one at a time, through a queue of its own that one fiber drains.
 *
 * Publishing never waits, so a slow subscriber cannot hold up the sync or
 * the other subscribers. The queue holds `CAPACITY` events. When it is full,
 * the subscriber's queued events are dropped, it gets one `Overflowed` next,
 * and then the new events; a warning names it. A subscriber that keeps state
 * from events treats `Overflowed` as "read it again".
 *
 * A subscriber's queue and fiber live in a child of the sync's scope, so the
 * events of an ended session are never delivered to the next one, and they
 * close as soon as the subscriber's own scope does.
 */
import type { Me } from '@juno/domain'
import type { SocketEvent } from '@juno/slack'
import { Context, Effect, Exit, Layer, Queue, Scope, Semaphore } from 'effect'
import type { SlackServices } from './session/Session'
import type { StoreServices } from './workspace'

/** How many events one subscriber may fall behind before its queued events are dropped. */
export const CAPACITY = 1024

/** In place of the events a subscriber fell too far behind to get. */
export interface Overflowed {
  readonly _tag: 'Overflowed'
}

const overflowed: Overflowed = { _tag: 'Overflowed' }

export type SocketInput = SocketEvent | Overflowed

/** Handles one input of the session it was started for. Failures are logged and the next input follows. */
export type SocketListener = (input: SocketInput, me: Me) => Effect.Effect<void>

/** What the sync calls after each event. It never waits for a subscriber. */
export type SocketPublisher = (event: SocketEvent, me: Me) => Effect.Effect<void>

/** What a session start may use: the running session's Slack client, the open workspace's store, and the sync's scope. */
export type SessionServices = SlackServices | StoreServices | Scope.Scope

export type SessionStart = Effect.Effect<SocketListener, never, SessionServices>

interface Subscriber {
  readonly name: string
  readonly start: SessionStart
}

interface Delivery {
  readonly name: string
  readonly queue: Queue.Queue<readonly [SocketInput, Me]>
  readonly scope: Scope.Closeable
}

interface Attached {
  readonly context: Context.Context<SessionServices>
  readonly scope: Scope.Scope
  readonly deliveries: Map<object, Delivery>
}

export class SocketEvents extends Context.Service<SocketEvents, {
  /** Starts `start` for the running sync, if any, and for every later one, until the calling scope closes. `name` is for the logs. */
  readonly subscribe: (name: string, start: SessionStart) => Effect.Effect<void, never, Scope.Scope>
  /** For `SyncRunner`: starts every subscriber in the sync's scope and returns the publisher for `runSync`'s `onEvent`. */
  readonly attach: Effect.Effect<SocketPublisher, never, SessionServices>
}>()('juno/engine/SocketEvents') {
  static readonly layer = Layer.effect(SocketEvents, Effect.gen(function* () {
    // Serializes subscribing, attaching and their ends, so each pair of subscriber and session starts once.
    const lock = yield* Semaphore.make(1)
    const subscribers = new Map<object, Subscriber>()
    let current: Attached | undefined

    const start = (attached: Attached, key: object, { name, start: sessionStart }: Subscriber) =>
      Effect.flatMap(Scope.fork(attached.scope, 'sequential'), (scope) => Effect.gen(function* () {
        const queue = yield* Queue.bounded<readonly [SocketInput, Me]>(CAPACITY)
        yield* Scope.addFinalizer(scope, Queue.shutdown(queue))
        const listener = yield* sessionStart.pipe(Effect.provideService(Scope.Scope, scope), Effect.provideContext(attached.context))
        yield* Effect.forkIn(
          // A throw or a defect is logged and the next input follows; an interruption ends the fiber.
          Effect.forever(Effect.flatMap(Queue.take(queue), ([input, me]) =>
            Effect.suspend(() => listener(input, me)).pipe(Effect.catchDefect((defect) => Effect.logWarning('socket events: a subscriber failed on an event', { subscriber: name, defect }))))),
          scope,
        )
        attached.deliveries.set(key, { name, queue, scope })
      }).pipe(Effect.catchCause((cause) => Effect.logError('socket events: a subscriber did not start', { cause }).pipe(Effect.andThen(Scope.close(scope, Exit.void))))))

    const stop = (attached: Attached, key: object) =>
      Effect.suspend(() => {
        const delivery = attached.deliveries.get(key)
        attached.deliveries.delete(key)
        return delivery === undefined ? Effect.void : Scope.close(delivery.scope, Exit.void)
      })

    // Never waits: a full queue is emptied, and the subscriber gets `Overflowed` before the new event.
    const offer = ({ name, queue }: Delivery, item: readonly [SocketEvent, Me]) =>
      Effect.suspend(() => {
        if (Queue.offerUnsafe(queue, item)) return Effect.void
        return Queue.clear(queue).pipe(Effect.flatMap((dropped) => {
          // A queue that closed meanwhile takes neither and was cleared to nothing.
          if (!Queue.offerUnsafe(queue, [overflowed, item[1]]) || !Queue.offerUnsafe(queue, item)) return Effect.void
          return Effect.logWarning('socket events: a subscriber fell behind; its queued events were dropped', { subscriber: name, dropped: dropped.length })
        }))
      })

    const subscribe = (name: string, sessionStart: SessionStart) =>
      Effect.gen(function* () {
        const key = {}
        const subscriber: Subscriber = { name, start: sessionStart }
        yield* Effect.acquireRelease(
          lock.withPermits(1)(Effect.suspend(() => {
            subscribers.set(key, subscriber)
            return current === undefined ? Effect.void : start(current, key, subscriber)
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
          for (const [key, subscriber] of subscribers) yield* start(attached, key, subscriber)
        })),
        // The deliveries close with the sync's scope.
        () => lock.withPermits(1)(Effect.sync(() => {
          if (current === attached) current = undefined
        })),
      )
      const publish: SocketPublisher = (event, me) =>
        Effect.suspend(() => Effect.forEach([...attached.deliveries.values()], (delivery) => offer(delivery, [event, me]), { discard: true }))
      return publish
    })

    return SocketEvents.of({ subscribe, attach })
  }))
}
