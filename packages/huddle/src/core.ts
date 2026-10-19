/**
 * The service's state and the steps that change it.
 *
 * Every change runs under one lock (`step`): the user's commands, the
 * renderer's media reports, main's page reports, `rooms.join` answers,
 * leave outcomes and socket inputs. After each, `drive` does what the rules
 * in `lifecycle.ts` call for: it gives `rooms.leave` to the Slack client for
 * every queued leave that is not the current call's (never waiting for the
 * answer), deletes the stored record of each one that went out and whose
 * media stopped, and sends `rooms.join` once nothing is left to clean up.
 *
 * A leave counts as sent only once its request goes out (`beforeSend`). One
 * the client refused first (a rate limit, the network, the session) is kept,
 * or stored again if it was already cleared, and sent again after a pause.
 *
 * A `rooms.join` answer is stored as a pending leave before anything else,
 * and only then are the Chime credentials handed to the page that asked. A
 * cancelled answer is never handed out. The join runs in the session's work
 * scope, not the caller's fiber, so its answer is handled even after a
 * Leave or while the session closes.
 */
import { Deferred, Effect, Queue, Result, Semaphore, SubscriptionRef, type Scope } from 'effect'
import { Offline, Rejected, type HuddleCall, type HuddleError, type HuddleMediaEvent, type HuddleStartResult, type RunningHuddles } from '@juno/contract'
import type { SlackApiError } from '@juno/slack'
import type { MethodOk } from '@juno/slack-schema'
import type { HuddleSession } from './Huddle'
import * as L from './lifecycle'
import { applyJoined, toRunningHuddles, type Running } from './running'
import { codeOf, joinedFrom, joinRequest, leaveRequest, toHuddleError } from './slack'

/** What the running-huddle reads know about the socket. `unknown` after `Overflowed`, which may have dropped a connect or a drop. */
export interface Info {
  connection: 'up' | 'down' | 'unknown'
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
  /** The workspace's stored leaves were read. Until then no join is sent and nothing stored is rewritten. */
  loaded: boolean
}

/**
 * Renderer page generations as main reports them. A generation is gone
 * once main has reported and does not list it, unless this process saw it
 * in a Start but not yet in a report (main's report may come after).
 */
interface Pages {
  reported: boolean
  live: ReadonlySet<string>
  readonly seen: Set<string>
  readonly used: Set<string>
}

export interface Core {
  readonly lock: Semaphore.Semaphore
  s: L.Lifecycle
  running: Running
  attached: Attached | undefined
  tickets: number
  leavesInFlight: number
  readonly waiters: Map<number, Deferred.Deferred<HuddleStartResult, HuddleError>>
  readonly pages: Pages
  /** Refusals in a row per attendee, for the pause before the next try. */
  readonly attempts: Map<string, number>
  readonly callRef: SubscriptionRef.SubscriptionRef<HuddleCall>
  readonly runningRef: SubscriptionRef.SubscriptionRef<RunningHuddles>
}

export const gone = (core: Core): L.Gone => (generation) => {
  const { reported, live, seen, used } = core.pages
  return reported && !live.has(generation) && (seen.has(generation) || !used.has(generation))
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
    pages: { reported: false, live: new Set(), seen: new Set(), used: new Set() },
    attempts: new Map(),
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

/** Rewrites the workspace's stored list. A failure is logged and kept for the next change to try again. */
const store = (core: Core, to: Attached, next: L.Lifecycle) =>
  to.session.leaves.write(L.storedIn(next, to.session.workspace)).pipe(
    Effect.as(true),
    Effect.catch((error) => Effect.logWarning('huddle: the stored leaves were not rewritten', { cause: error.cause }).pipe(Effect.as(false))),
  )

/** Model `answerJoin` or `joinError`, under the lock. */
const answered = (core: Core, to: Attached, intent: L.Intent, answer: Result.Result<MethodOk<'rooms.join'>, SlackApiError>) =>
  Effect.gen(function* () {
    const workspace = to.session.workspace
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
    const record = L.recordFor(core.s, identity)
    // The record is durable before the credentials leave this function (model `answerJoin`).
    const stored = yield* Effect.result(to.session.leaves.write([...L.storedIn(core.s, workspace), record]))
    if (Result.isFailure(stored)) {
      yield* Effect.logError('huddle: the pending leave was not stored; leaving at once', { cause: stored.failure.cause })
      // As a cancelled answer: never handed out, and left at once.
      core.s = L.answerJoin({ ...core.s, cancel: true }, { ...identity, generation: null }, workspace)
      if (waiter !== undefined) yield* Deferred.die(waiter, stored.failure)
      return
    }
    core.s = L.answerJoin(core.s, record, workspace)
    if (Result.isSuccess(answer)) core.running = applyJoined(core.running, identity.channelId, identity.callId, answer.success.huddle)
    yield* markDue(to, identity.channelId)
    if (record.generation === null || waiter === undefined) return
    yield* Deferred.succeed(waiter, { _tag: 'joined', channelId: identity.channelId, callId: identity.callId, attendeeId: identity.attendeeId, credentials })
  })

/** One join, in the work scope. The answer is handled under the lock even when its Start was cancelled. */
const join = (core: Core, to: Attached, intent: L.Intent) =>
  Effect.result(joinRequest(to.session, intent)).pipe(Effect.flatMap((answer) => step(core, answered(core, to, intent, answer))))

/** The pause before sending a refused leave again. */
const pauseAfter = (core: Core, attendeeId: string, error: SlackApiError) => {
  const attempt = (core.attempts.get(attendeeId) ?? 0) + 1
  core.attempts.set(attendeeId, attempt)
  const backoff = Math.min(1_000 * 2 ** (attempt - 1), 60_000)
  return error._tag === 'SlackRateLimited' ? Math.max(error.retryAfterMillis, backoff) : backoff
}

/** One leave, in the work scope. Marked sent when its request goes out; a refusal keeps it and tries again later. */
const sendLeave = (core: Core, to: Attached, record: L.Stored) =>
  Effect.gen(function* () {
    const attendeeId = record.attendeeId
    const goesOut = step(core, Effect.sync(() => {
      core.s = L.dispatched(core.s, attendeeId)
    }))
    const outcome = yield* leaveRequest(to.session, record, goesOut)
    if (outcome === undefined) {
      core.attempts.delete(attendeeId)
      return
    }
    const pause = pauseAfter(core, attendeeId, outcome)
    yield* step(core, Effect.gen(function* () {
      const cleared = !core.s.pending.some((p) => p.record.attendeeId === attendeeId)
      core.s = L.refused(core.s, record, to.session.workspace)
      // A record already cleared is stored again; its media had stopped.
      if (cleared && to.loaded) yield* store(core, to, core.s)
    }))
    yield* Effect.forkIn(Effect.sleep(pause).pipe(Effect.andThen(step(core, Effect.sync(() => {
      core.s = L.retry(core.s, attendeeId)
    })))), to.work)
  }).pipe(Effect.ensuring(Effect.sync(() => {
    core.leavesInFlight -= 1
  })))

/** What the rules call for after a change. Runs under the lock. */
const drive = (core: Core) =>
  Effect.gen(function* () {
    const to = core.attached
    if (to !== undefined) {
      const workspace = to.session.workspace
      for (const record of L.toSend(core.s, workspace)) {
        core.s = L.sending(core.s, record.attendeeId)
        core.leavesInFlight += 1
        yield* Effect.forkIn(sendLeave(core, to, record), to.work)
      }
      const clear = L.toClear(core.s, workspace)
      if (to.loaded && clear.length > 0) {
        const next = L.clearLeave(core.s, new Set(clear.map((record) => record.attendeeId)))
        if (yield* store(core, to, next)) core.s = next
      }
      if (L.canRequest(core.s, workspace, to.loaded)) {
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

export const start = Effect.fn('Huddle.start')(function* (core: Core, channelId: string, region: string | null, generation: string) {
  const waiter = yield* Deferred.make<HuddleStartResult, HuddleError>()
  yield* step(core, Effect.gen(function* () {
    if (core.attached === undefined) return yield* new Offline()
    // A page main already called gone cannot run media.
    if (gone(core)(generation)) return yield* Deferred.succeed(waiter, { _tag: 'cancelled' })
    core.pages.used.add(generation)
    const ticket = ++core.tickets
    core.waiters.set(ticket, waiter)
    core.s = L.choose(core.s, { channelId, region, generation, ticket })
  }))
  return yield* Deferred.await(waiter)
})

export const leave = (core: Core) =>
  step(core, Effect.sync(() => {
    core.s = L.leave(core.s)
  }))

/** A report from a page main called gone is ignored: that page's media is already counted as stopped. */
export const media = (core: Core, event: HuddleMediaEvent) =>
  step(core, Effect.sync(() => {
    if (gone(core)(event.generation)) return
    switch (event._tag) {
      case 'started':
        core.s = L.mediaStarted(core.s, event.generation, event.attendeeId)
        return
      case 'ended':
        core.s = L.mediaEnded(core.s, event.generation, event.attendeeId, event.reason)
        return
      case 'muted':
        core.s = L.mediaMuted(core.s, event.generation, event.attendeeId, event.muted)
        return
    }
  }))

/** Main's report of the live page generations. */
export const pages = (core: Core, live: ReadonlyArray<string>) =>
  step(core, Effect.sync(() => {
    core.pages.reported = true
    core.pages.live = new Set(live)
    for (const generation of live) core.pages.seen.add(generation)
    core.s = L.pagesGone(core.s, gone(core))
  }))
