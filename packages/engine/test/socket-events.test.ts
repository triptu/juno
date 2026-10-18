import { it } from '@effect/vitest'
import { UserId } from '@juno/domain'
import type { SocketEvent } from '@juno/slack'
import { Context, Deferred, Effect, Exit, Queue, Scope } from 'effect'
import { expect } from 'vitest'
import { CAPACITY, SocketEvents, type SessionServices, type SessionStart, type SocketInput } from '../src/socketEvents'

const me = { userId: UserId.make('U0ME') }
const event = (n: number): SocketEvent => ({ _tag: 'Disconnected', reason: String(n), retryInMillis: 0 })
const label = (input: SocketInput) => input._tag === 'Disconnected' ? input.reason : input._tag
// The subscribers below use no session service, so a sync's context can be empty.
const noServices = Context.empty() as Context.Context<Exclude<SessionServices, Scope.Scope>>

/** A subscriber that records which session it heard each input in. `each` runs before an input is recorded. */
const recorder = (each: (input: SocketInput) => Effect.Effect<void> = () => Effect.void) => Effect.gen(function* () {
  const heard = yield* Queue.unbounded<string>()
  let sessions = 0
  const start: SessionStart = Effect.sync(() => {
    const session = ++sessions
    return (input) => each(input).pipe(Effect.andThen(Queue.offer(heard, `${session}:${label(input)}`)), Effect.asVoid)
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
  const early = yield* recorder()
  const late = yield* recorder()
  const earlyScope = yield* Scope.make()
  yield* events.subscribe('early', early.start).pipe(Scope.provide(earlyScope))

  const first = yield* sync
  yield* first.publish(1)
  // Subscribing while a sync runs starts the subscriber for that sync too.
  yield* events.subscribe('late', late.start)
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

it.effect('a stuck subscriber never holds up the sync or the others, and hears Overflowed before newer events', () => Effect.gen(function* () {
  const events = yield* SocketEvents
  const busy = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const stuck = yield* recorder((input) => label(input) === '1' ? Deferred.succeed(busy, undefined).pipe(Effect.andThen(Deferred.await(release))) : Effect.void)
  const other = yield* recorder()
  yield* events.subscribe('stuck', stuck.start)
  yield* events.subscribe('other', other.start)
  const running = yield* sync
  yield* running.publish(1)
  yield* Deferred.await(busy)
  // One more than the queue holds, then two newer ones: none of these waits.
  for (let n = 2; n <= CAPACITY + 4; n++) yield* running.publish(n)
  expect(yield* other.next(CAPACITY + 4)).toEqual(Array.from({ length: CAPACITY + 4 }, (_, i) => `1:${i + 1}`))
  yield* Deferred.succeed(release, undefined)
  expect(yield* stuck.next(5)).toEqual(['1:1', '1:Overflowed', `1:${CAPACITY + 2}`, `1:${CAPACITY + 3}`, `1:${CAPACITY + 4}`])
  yield* running.end
}).pipe(Effect.provide(SocketEvents.layer), Effect.scoped))

it.effect('a listener that throws or dies on one event still hears the later ones', () => Effect.gen(function* () {
  const events = yield* SocketEvents
  const heard = yield* Queue.unbounded<string>()
  yield* events.subscribe('fragile', Effect.succeed((input) => {
    if (label(input) === '2') throw new Error('thrown')
    if (label(input) === '3') return Effect.die('died')
    return Queue.offer(heard, label(input)).pipe(Effect.asVoid)
  }))
  const running = yield* sync
  for (const n of [1, 2, 3, 4]) yield* running.publish(n)
  expect(yield* Effect.replicateEffect(Queue.take(heard), 2)).toEqual(['1', '4'])
  yield* running.end
}).pipe(Effect.provide(SocketEvents.layer), Effect.scoped))
