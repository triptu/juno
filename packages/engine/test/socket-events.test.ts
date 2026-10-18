import { it } from '@effect/vitest'
import { UserId } from '@juno/domain'
import type { SocketEvent } from '@juno/slack'
import { Context, Effect, Exit, Queue, Scope } from 'effect'
import { expect } from 'vitest'
import { SocketEvents, type SessionServices, type SessionStart } from '../src/socketEvents'

const me = { userId: UserId.make('U0ME') }
const event = (n: number): SocketEvent => ({ _tag: 'Disconnected', reason: String(n), retryInMillis: 0 })
// The subscribers below use no session service, so a sync's context can be empty.
const noServices = Context.empty() as Context.Context<Exclude<SessionServices, Scope.Scope>>

/** A subscriber that records which session it heard each event in. */
const recorder = Effect.gen(function* () {
  const heard = yield* Queue.unbounded<string>()
  let sessions = 0
  const start: SessionStart = Effect.sync(() => {
    const session = ++sessions
    return (event) => event._tag === 'Disconnected' ? Queue.offer(heard, `${session}:${event.reason}`).pipe(Effect.asVoid) : Effect.void
  })
  const next = (n: number) => Effect.replicateEffect(Queue.take(heard), n)
  return { start, heard, next }
})

const sync = Effect.gen(function* () {
  const events = yield* SocketEvents
  const scope = yield* Scope.make()
  const publish = yield* events.attach.pipe(Effect.provide(noServices), Scope.provide(scope))
  return { publish: (n: number) => publish(event(n), me), end: Scope.close(scope, Exit.void) }
})

it.effect('subscribers hear each sync\'s events in order, from the sync they started in, until they leave', () => Effect.gen(function* () {
  const events = yield* SocketEvents
  const early = yield* recorder
  const late = yield* recorder
  const earlyScope = yield* Scope.make()
  yield* events.subscribe(early.start).pipe(Scope.provide(earlyScope))

  const first = yield* sync
  yield* first.publish(1)
  // Subscribing while a sync runs starts the subscriber for that sync too.
  yield* events.subscribe(late.start)
  yield* first.publish(2)
  yield* first.publish(3)
  expect(yield* early.next(3)).toEqual(['1:1', '1:2', '1:3'])
  expect(yield* late.next(2)).toEqual(['1:2', '1:3'])
  yield* first.end

  // A new session starts every subscriber again.
  const second = yield* sync
  yield* second.publish(4)
  expect(yield* early.next(1)).toEqual(['2:4'])
  expect(yield* late.next(1)).toEqual(['2:4'])

  // A subscriber whose scope closes hears nothing more.
  yield* Scope.close(earlyScope, Exit.void)
  yield* second.publish(5)
  expect(yield* late.next(1)).toEqual(['2:5'])
  expect(yield* Queue.size(early.heard)).toBe(0)
  yield* second.end
}).pipe(Effect.provide(SocketEvents.layer), Effect.scoped))
