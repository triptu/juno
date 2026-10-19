/**
 * The service's state and the steps that change it.
 *
 * Every change runs under one lock (`step`): the user's commands, the
 * renderer's media reports, `rooms.join` answers and socket inputs. After
 * each, `drive` does what the rules in `lifecycle.ts` call for: it sends
 * `rooms.leave` for every pending attendee that is not the current call's
 * (never waiting for the answer), deletes the stored record of each one
 * that was sent and stopped, and sends `rooms.join` once nothing is left
 * to clean up.
 *
 * A `rooms.join` answer is stored as a pending leave before anything else,
 * and only then are the Chime credentials handed to the caller of `start`.
 * A cancelled answer is never handed out. The join runs in the session's
 * work scope, not the caller's fiber, so its answer is handled even after
 * a Leave or while the session closes.
 */
import { Deferred, Effect, Queue, Result, Semaphore, SubscriptionRef, type Scope } from 'effect'
import { Offline, Rejected, type HuddleCall, type HuddleError, type HuddleMediaEvent, type HuddleStartResult, type RunningHuddles } from '@juno/contract'
import type { SlackApiError } from '@juno/slack'
import type { MethodOk } from '@juno/slack-schema'
import type { HuddleSession } from './Huddle'
import * as L from './lifecycle'
import { applyJoined, toRunningHuddles, type Running } from './running'
import { codeOf, joinedFrom, joinRequest, leaveRequest, toHuddleError } from './slack'

/** What the running-huddle reads know about the socket. */
export interface Info {
  connected: boolean
  /** Bumped by every socket gap (disconnect, reconnect, `Overflowed`). */
  gap: number
  dirtyAll: boolean
  readonly dirty: Set<string>
  /** Bumped per channel by each room frame. */
  readonly frameGen: Map<string, number>
  readonly wake: Queue.Queue<void>
}

export interface Attached {
  readonly session: HuddleSession
  /** Joins, leaves and reads run here; it closes after the detach has waited for them. */
  readonly work: Scope.Closeable
  readonly info: Info
}

export interface Core {
  readonly lock: Semaphore.Semaphore
  s: L.Lifecycle
  running: Running
  attached: Attached | undefined
  tickets: number
  leavesInFlight: number
  readonly waiters: Map<number, Deferred.Deferred<HuddleStartResult, HuddleError>>
  /** Attendees the renderer said stopped, for records a later session loads. */
  readonly stoppedAttendees: Set<string>
  /** The renderer said no session runs, and no credentials went out since. */
  rendererIdle: boolean
  readonly callRef: SubscriptionRef.SubscriptionRef<HuddleCall>
  readonly runningRef: SubscriptionRef.SubscriptionRef<RunningHuddles>
}

const toCall = (s: L.Lifecycle, running: Running): HuddleCall => {
  const channelId = L.callChannel(s) ?? null
  const entry = channelId === null ? undefined : running.get(channelId)
  const identity = s.current?.identity
  return {
    phase: L.phaseOf(s),
    channelId,
    callId: identity?.callId ?? null,
    attendeeId: identity?.attendeeId ?? null,
    participants: entry?.participants ?? [],
    startedAt: entry?.startedAt ?? null,
    muted: s.muted,
    ended: s.ended ?? null,
  }
}

export const makeCore = Effect.gen(function* () {
  const core: Core = {
    lock: yield* Semaphore.make(1),
    s: L.initial,
    running: new Map(),
    attached: undefined,
    tickets: 0,
    leavesInFlight: 0,
    waiters: new Map(),
    stoppedAttendees: new Set(),
    rendererIdle: false,
    callRef: yield* SubscriptionRef.make(toCall(L.initial, new Map())),
    runningRef: yield* SubscriptionRef.make<RunningHuddles>({}),
  }
  return core
})

export const publish = (core: Core) =>
  Effect.suspend(() => SubscriptionRef.set(core.callRef, toCall(core.s, core.running))).pipe(
    Effect.andThen(Effect.suspend(() => SubscriptionRef.set(core.runningRef, toRunningHuddles(core.running)))),
  )

/** A Start whose intent is gone (replaced, left, evicted, quit) answers `cancelled`. */
export const settleWaiters = (core: Core) =>
  Effect.suspend(() => {
    const { s, waiters } = core
    const live = new Set([s.wanted?.ticket, s.request !== undefined && !s.cancel ? s.request.ticket : undefined])
    const done = [...waiters].filter(([ticket]) => !live.has(ticket))
    for (const [ticket] of done) waiters.delete(ticket)
    return Effect.forEach(done, ([, deferred]) => Deferred.succeed(deferred, { _tag: 'cancelled' }), { discard: true })
  })

export const markDue = (to: Attached, channel: string | 'all') =>
  Effect.suspend(() => {
    if (channel === 'all') to.info.dirtyAll = true
    else to.info.dirty.add(channel)
    return Queue.offer(to.info.wake, undefined)
  })

/** Model `answerJoin` or `joinError`, under the lock. */
const answered = (core: Core, to: Attached, intent: L.Intent, answer: Result.Result<MethodOk<'rooms.join'>, SlackApiError>) =>
  Effect.gen(function* () {
    const waiter = core.waiters.get(intent.ticket)
    core.waiters.delete(intent.ticket)
    const joined = Result.isSuccess(answer) ? joinedFrom(intent.channelId, answer.success) : undefined
    if (joined === undefined) {
      const failure = Result.isFailure(answer) ? yield* toHuddleError(answer.failure) : new Rejected({ code: 'create_meeting_failed' })
      if (!core.s.cancel && waiter !== undefined) yield* Deferred.fail(waiter, failure)
      core.s = L.joinError(core.s, codeOf(failure))
      return
    }
    const { identity, credentials } = joined
    // The record is durable before the credentials leave this function (model `answerJoin`).
    const stored = yield* Effect.result(to.session.leaves.write([...core.s.pending.map((p) => p.identity), identity]))
    if (Result.isFailure(stored)) {
      yield* Effect.logError('huddle: the pending leave was not stored; leaving at once', { cause: stored.failure.cause })
      // As a cancelled answer: never handed out, left at once, dropped from memory once sent.
      core.s = L.answerJoin({ ...core.s, cancel: true }, identity)
      if (waiter !== undefined) yield* Deferred.die(waiter, stored.failure)
      return
    }
    const cancelled = core.s.cancel
    core.s = L.answerJoin(core.s, identity)
    if (Result.isSuccess(answer)) core.running = applyJoined(core.running, identity.channelId, identity.callId, answer.success.huddle)
    yield* markDue(to, identity.channelId)
    if (cancelled || waiter === undefined) return
    core.rendererIdle = false
    yield* Deferred.succeed(waiter, { _tag: 'joined', channelId: identity.channelId, callId: identity.callId, attendeeId: identity.attendeeId, credentials })
  })

/** One join, in the work scope. The answer is handled under the lock even when its Start was cancelled. */
const join = (core: Core, to: Attached, intent: L.Intent) =>
  Effect.result(joinRequest(to.session, intent)).pipe(Effect.flatMap((answer) => step(core, answered(core, to, intent, answer))))

/** What the rules call for after a change. Runs under the lock. */
const drive = (core: Core) =>
  Effect.gen(function* () {
    const to = core.attached
    if (to !== undefined) {
      for (const identity of L.toSend(core.s)) {
        core.s = L.sendLeave(core.s, identity.attendeeId)
        core.leavesInFlight += 1
        yield* Effect.forkIn(leaveRequest(to.session, identity).pipe(Effect.ensuring(Effect.sync(() => { core.leavesInFlight -= 1 }))), to.work)
      }
      const clear = L.toClear(core.s)
      if (clear.length > 0) {
        const next = L.clearLeave(core.s, new Set(clear.map((identity) => identity.attendeeId)))
        const written = yield* Effect.result(to.session.leaves.write(next.pending.map((p) => p.identity)))
        // Kept until the next change tries again; a repeated leave is harmless.
        if (Result.isFailure(written)) yield* Effect.logWarning('huddle: a sent leave was not cleared', { cause: written.failure.cause })
        else core.s = next
      }
      if (L.canRequest(core.s)) {
        const intent = core.s.wanted
        core.s = L.requestJoin(core.s)
        yield* Effect.forkIn(join(core, to, intent), to.work)
      }
    }
    yield* settleWaiters(core)
    yield* publish(core)
  })

/** Runs `change` under the lock, then `drive`. */
export function step<A, E>(core: Core, change: Effect.Effect<A, E>): Effect.Effect<A, E> {
  return core.lock.withPermits(1)(change.pipe(Effect.ensuring(drive(core))))
}

export const start = Effect.fn('Huddle.start')(function* (core: Core, channelId: string, region: string | null) {
  const waiter = yield* Deferred.make<HuddleStartResult, HuddleError>()
  yield* step(core, Effect.gen(function* () {
    if (core.attached === undefined) return yield* new Offline()
    const ticket = ++core.tickets
    core.waiters.set(ticket, waiter)
    core.s = L.choose(core.s, { channelId, region, ticket })
  }))
  return yield* Deferred.await(waiter)
})

export const leave = (core: Core) =>
  step(core, Effect.sync(() => {
    core.s = L.leave(core.s)
  }))

export const media = (core: Core, event: HuddleMediaEvent) =>
  step(core, Effect.sync(() => {
    switch (event._tag) {
      case 'started':
        core.s = L.mediaStarted(core.s, event.attendeeId)
        return
      case 'ended':
        core.stoppedAttendees.add(event.attendeeId)
        core.s = L.mediaEnded(core.s, event.attendeeId, event.reason)
        return
      case 'muted':
        core.s = L.mediaMuted(core.s, event.attendeeId, event.muted)
        return
      case 'idle':
        core.rendererIdle = true
        core.s = L.mediaIdle(core.s)
        return
    }
  }))
