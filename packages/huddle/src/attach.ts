/**
 * A session for the service: the engine attaches it once per sync, with
 * that sync's Slack client and the open workspace's store.
 *
 * Attaching loads the stored leaves first (model `restart`), so they go out
 * before any new join. Detaching (sign-out, quit) leaves the call (model
 * `quit`), waits a little for a join in flight and the leaves it sends, and
 * keeps the stored records for the workspace's next session.
 */
import { Effect, Queue, Scope } from 'effect'
import { publish, settleWaiters, step, type Attached, type Core } from './core'
import type { HuddleSession } from './Huddle'
import * as L from './lifecycle'
import { listener, reader } from './reads'

/** At quit or sign-out, how long to wait for a join in flight and the leaves sent. Main kills the engine 3 s after `quit`. */
export const DETACH_WAIT_MILLIS = 2_000

/** Waits until `done` holds or `millis` pass. */
const waitUntil = (done: () => boolean, millis: number) =>
  Effect.sleep(50).pipe(Effect.repeat({ until: done }), Effect.timeoutOption(millis), Effect.asVoid)

const detach = (core: Core, to: Attached) =>
  Effect.gen(function* () {
    // No call and no queued join; the leaves go out now.
    yield* step(core, Effect.sync(() => {
      core.s = L.quit(core.s)
    }))
    // A join in flight is answered and cleaned up, if it answers in time.
    yield* waitUntil(() => core.s.request === undefined, DETACH_WAIT_MILLIS)
    yield* waitUntil(() => core.leavesInFlight === 0, DETACH_WAIT_MILLIS)
    yield* core.lock.withPermits(1)(Effect.gen(function* () {
      if (core.attached === to) core.attached = undefined
      // The records stay stored for this workspace's next session, which sends them again.
      core.s = { ...L.quit(core.s), request: undefined, cancel: false, pending: [] }
      core.running = new Map()
      yield* settleWaiters(core)
      yield* publish(core)
    }))
  })

export const attach = Effect.fn('Huddle.attach')(function* (core: Core, session: HuddleSession) {
  const scope = yield* Effect.scope
  // Made before the detach is registered, so it closes after the detach has waited.
  const work = yield* Scope.fork(scope, 'sequential')
  const to: Attached = {
    session,
    work,
    info: { connected: false, gap: 0, dirtyAll: true, dirty: new Set(), frameGen: new Map(), wake: yield* Queue.sliding<void>(1) },
  }
  const stored = yield* session.leaves.read
  // The stored leaves are pending before any join can be sent.
  yield* step(core, Effect.sync(() => {
    core.attached = to
    core.running = new Map()
    core.s = L.restart(core.s, stored, (attendeeId) => core.rendererIdle || core.stoppedAttendees.has(attendeeId))
  }))
  yield* Scope.addFinalizer(scope, detach(core, to))
  yield* Effect.forkIn(reader(core, to), work)
  return listener(core, to)
})
