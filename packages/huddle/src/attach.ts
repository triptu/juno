/**
 * A session for the service: the engine attaches it once per sync, with
 * that sync's Slack client and the open workspace's store.
 *
 * Attaching loads the workspace's stored leaves first (model `restart`), so
 * they go out before any new join. A read that fails is not taken for an
 * empty list: joins wait, and the read is tried again. Detaching (sign-out,
 * quit) leaves the call (model `quit`) and waits a little for a join in
 * flight and the leaves it gives the client. The records stay stored for
 * the workspace's next session, and stay in memory, so no join overlaps a
 * page that may still run their media. Whether that media stopped is
 * computed from the pages' state (`media.ts`), so a page's report that came
 * before the load still counts.
 */
import { Effect, Queue, Result, Scope } from 'effect'
import { failureOf } from './failure'
import { publish, settleWaiters, step, type Attached, type Core } from './core'
import type { HuddleSession } from './Huddle'
import * as L from './lifecycle'
import { listener, reader } from './reads'

/** At quit or sign-out, how long to wait for a join in flight and the leaves sent. Main kills the engine 3 s after `quit`. */
export const DETACH_WAIT_MILLIS = 2_000

/** Waits until `done` holds or `millis` pass. Returns at once when it already holds, so a stop never waits on the clock for nothing. */
const waitUntil = (done: () => boolean, millis: number) =>
  Effect.suspend(() => (done() ? Effect.void : Effect.sleep(50).pipe(Effect.repeat({ until: done }), Effect.timeoutOption(millis), Effect.asVoid)))

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
      core.s = L.detached(core.s, to.session.workspace)
      core.running = new Map()
      yield* settleWaiters(core)
      yield* publish(core)
    }))
  })

/** Reads the stored leaves until a read succeeds, then merges them in and lets joins go. */
const load = (core: Core, to: Attached) =>
  Effect.gen(function* () {
    let pause = 1_000
    while (true) {
      const stored = yield* Effect.result(to.session.leaves.read)
      if (Result.isSuccess(stored)) {
        return yield* step(core, Effect.sync(() => {
          core.s = L.restart(core.s, stored.success, to.session.workspace)
          to.loaded = true
        }))
      }
      yield* Effect.logWarning('huddle: the stored leaves could not be read; joins wait', { error: failureOf(stored.failure) })
      yield* Effect.sleep(pause)
      pause = Math.min(pause * 2, 30_000)
    }
  })

export const attach = Effect.fn('Huddle.attach')(function* (core: Core, session: HuddleSession) {
  const scope = yield* Effect.scope
  // Made before the detach is registered, so it closes after the detach has waited.
  const work = yield* Scope.fork(scope, 'sequential')
  const to: Attached = {
    session,
    work,
    info: { connection: 'unknown', gap: 0, dirtyAll: true, dirty: new Set(), frameGen: new Map(), wake: yield* Queue.sliding<void>(1) },
    loaded: false,
  }
  yield* step(core, Effect.sync(() => {
    core.attached = to
    core.running = new Map()
    core.s = L.restart(core.s, [], session.workspace)
  }))
  yield* Scope.addFinalizer(scope, detach(core, to))
  yield* Effect.forkIn(load(core, to), work)
  yield* Effect.forkIn(reader(core, to), work)
  return listener(core, to)
})
