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
import { Clock, Deferred, Effect, Fiber, Queue, Result, Semaphore, SubscriptionRef, type Scope } from 'effect'
import { Offline, Rejected, type HuddleCall, type HuddleError, type HuddlePageReport, type HuddleStartResult, type RunningHuddles } from '@juno/contract'
import type { SlackApiError } from '@juno/slack'
import type { MethodOk } from '@juno/slack-schema'
import { aloneNow, leaveAt, type Alone } from './alone'
import type { HuddleSession } from './Huddle'
import { failureOf } from './failure'
import * as L from './lifecycle'
import { noMedia, pageState, type MediaView, type Received } from './media'
import { applyJoined, toRunningHuddles, type Running } from './running'
import { codeOf, joinedFrom, joinRequest, leaveRequest, toHuddleError } from './slack'
import { keepStatus } from './status'

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

/** Renderer page generations as main reports them (`media.ts`). */
interface Pages {
  reported: boolean
  live: ReadonlySet<number>
  maxIssued: number
}

/**
 * A Start waiting for its answer, and the engine connection it came on.
 * `state` moves once, from `waiting` to `delivered` (the answer handed the
 * credentials over) or to `cancelled` (the caller went: its RPC was
 * cancelled or its connection closed). The cancel does not take the lock,
 * so it can land while an answer is being stored; the hand-off checks it
 * after the store.
 */
interface Waiter {
  readonly deferred: Deferred.Deferred<HuddleStartResult, HuddleError>
  readonly connection: number
  state: 'waiting' | 'delivered' | 'cancelled'
}

export interface Core {
  readonly lock: Semaphore.Semaphore
  s: L.Lifecycle
  running: Running
  attached: Attached | undefined
  tickets: number
  leavesInFlight: number
  readonly waiters: Map<number, Waiter>
  readonly pages: Pages
  /** The latest whole-state report of each page not known to be gone, with the connection it came on. */
  readonly reports: Map<number, Received>
  /** The hand-offs of this process, by attendee: the connection the Start came on. */
  readonly handed: Map<string, number>
  /** Workspaces whose stored leaves are still to be read at boot (`boot.ts`); undefined before the boot load began. */
  booting: ReadonlySet<string> | undefined
  /** Refusals in a row per attendee, for the pause before the next try. */
  readonly attempts: Map<string, number>
  readonly callRef: SubscriptionRef.SubscriptionRef<HuddleCall>
  readonly runningRef: SubscriptionRef.SubscriptionRef<RunningHuddles>
  /** The "In a huddle" status kept for the live call's attendee, if any. */
  status: { readonly attendeeId: string; readonly fiber: Fiber.Fiber<never> } | undefined
  /** The user alone in the live call, and the timer that leaves it (`alone.ts`). */
  alone: { readonly since: Alone; readonly fiber: Fiber.Fiber<void> } | undefined
}

/** The pages' current state, for the rules. */
export const view = (core: Core): MediaView => ({ pages: core.pages, reports: core.reports, handed: core.handed })

const toCall = (s: L.Lifecycle, media: MediaView, running: Running): HuddleCall => {
  const channelId = L.callChannel(s) ?? null
  const entry = channelId === null ? undefined : running.get(channelId)
  const identity = s.current?.identity
  const session = L.currentMedia(s, media)
  return {
    phase: L.phaseOf(s, media),
    channelId,
    callId: identity?.callId ?? null,
    attendeeId: identity?.attendeeId ?? null,
    participants: entry?.participants ?? [],
    startedAt: entry?.startedAt ?? null,
    connection: session?.connection ?? null,
    muted: session?.muted ?? false,
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
    pages: { reported: false, live: new Set(), maxIssued: 0 },
    reports: new Map(),
    handed: new Map(),
    booting: undefined,
    attempts: new Map(),
    callRef: yield* SubscriptionRef.make(toCall(L.initial, noMedia, new Map())),
    runningRef: yield* SubscriptionRef.make<RunningHuddles>({}),
    status: undefined,
    alone: undefined,
  }
  return core
})

/**
 * Leaves the call after the user has been alone in it for 10 minutes. Anyone joining, or the call ending or
 * changing, stops the timer, and it starts again the next time the user is alone. `publish` runs it, since
 * it follows every change of the call and of who is in it. Never waits.
 */
const followAlone = (core: Core, to: Attached | undefined) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const current = core.s.current?.identity
    const connection = L.currentMedia(core.s, view(core))?.connection
    const next = aloneNow(core.alone?.since, {
      attendeeId: current?.attendeeId,
      live: connection === 'connected' || connection === 'reconnecting',
      participants: current === undefined ? [] : core.running.get(current.channelId)?.participants ?? [],
    }, now)
    if (core.alone?.since === next) return
    const before = core.alone
    core.alone = undefined
    if (before !== undefined) yield* Effect.forkDetach(Fiber.interrupt(before.fiber))
    if (next === undefined || to === undefined) return
    const due = Effect.sleep(leaveAt(next, to.session.aloneLeaveMillis) - now).pipe(Effect.andThen(step(core, Effect.sync(() => {
      if (core.alone?.since !== next) return
      core.alone = undefined
      core.s = L.leave(core.s, 'alone')
    }))))
    core.alone = { since: next, fiber: yield* Effect.forkIn(due, to.work) }
  })

/** Sends the call and the running huddles to subscribers. Under the lock. */
export const publish = (core: Core) =>
  followAlone(core, core.attached).pipe(
    Effect.andThen(Effect.suspend(() => SubscriptionRef.set(core.callRef, toCall(core.s, view(core), core.running)))),
    Effect.andThen(Effect.suspend(() => SubscriptionRef.set(core.runningRef, toRunningHuddles(core.running)))),
  )

/** A Start whose intent is gone (replaced, left, evicted, quit) answers `cancelled`. */
export const settleWaiters = (core: Core) =>
  Effect.suspend(() => {
    const { s, waiters } = core
    const live = new Set([s.wanted?.ticket, s.request !== undefined && !s.cancel ? s.request.ticket : undefined])
    const done = [...waiters].filter(([ticket]) => !live.has(ticket))
    for (const [ticket] of done) waiters.delete(ticket)
    return Effect.forEach(done, ([, waiter]) => Deferred.succeed(waiter.deferred, { _tag: 'cancelled' }), { discard: true })
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
    Effect.catch((error) => Effect.logWarning('huddle: the stored leaves were not rewritten', { error: failureOf(error) }).pipe(Effect.as(false))),
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
      if (!core.s.cancel && waiter !== undefined) yield* Deferred.fail(waiter.deferred, failure)
      core.s = L.joinError(core.s, codeOf(failure))
      return
    }
    const { identity, credentials } = joined
    const record = L.recordFor(core.s, view(core), identity, waiter?.state === 'waiting')
    // The record is durable before the credentials leave this function (model `answerJoin`).
    const stored = yield* Effect.result(to.session.leaves.write([...L.storedIn(core.s, workspace), record]))
    if (Result.isFailure(stored)) {
      yield* Effect.logError('huddle: the pending leave was not stored; leaving at once', { error: failureOf(stored.failure) })
      // As a cancelled answer: never handed out, and left at once.
      core.s = L.answerJoin({ ...core.s, cancel: true }, { ...identity, generation: null }, workspace)
      if (waiter !== undefined) yield* Deferred.die(waiter.deferred, stored.failure)
      return
    }
    // The hand-off, in one step after the store: only a Start still waiting gets the credentials. One cancelled
    // meanwhile gets nothing, so no page has them: the attendee is stopped and left at once, as for a dead page.
    const delivered = record.generation !== null && waiter?.state === 'waiting'
    if (delivered) waiter.state = 'delivered'
    core.s = L.answerJoin(core.s, delivered ? record : { ...record, generation: null }, workspace)
    if (delivered) core.handed.set(identity.attendeeId, waiter.connection)
    if (Result.isSuccess(answer)) core.running = applyJoined(core.running, identity.channelId, identity.callId, answer.success.huddle)
    yield* markDue(to, identity.channelId)
    if (!delivered) return
    yield* Deferred.succeed(waiter.deferred, { _tag: 'joined', channelId: identity.channelId, callId: identity.callId, attendeeId: identity.attendeeId, credentials })
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

/** Keeps the status while the call is live (its media started), and stops it when the call ends or changes. Never waits. */
const followStatus = (core: Core, to: Attached | undefined) =>
  Effect.gen(function* () {
    const connection = L.currentMedia(core.s, view(core))?.connection
    const live = connection === 'connected' || connection === 'reconnecting' ? core.s.current?.identity.attendeeId : undefined
    if (core.status?.attendeeId === live) return
    const before = core.status
    core.status = undefined
    if (before !== undefined) yield* Effect.forkDetach(Fiber.interrupt(before.fiber))
    if (live !== undefined && to !== undefined) core.status = { attendeeId: live, fiber: yield* Effect.forkIn(keepStatus(to.session), to.work) }
  })

/** What the rules call for after a change. Runs under the lock. */
const drive = (core: Core) =>
  Effect.gen(function* () {
    const media = view(core)
    core.s = L.reconcile(core.s, media)
    const to = core.attached
    if (to !== undefined) {
      const workspace = to.session.workspace
      for (const record of L.toSend(core.s, workspace)) {
        core.s = L.sending(core.s, record.attendeeId)
        core.leavesInFlight += 1
        yield* Effect.forkIn(sendLeave(core, to, record), to.work)
      }
      const clear = L.toClear(core.s, media, workspace)
      if (to.loaded && clear.length > 0) {
        const next = L.clearLeave(core.s, new Set(clear.map((record) => record.attendeeId)))
        if (yield* store(core, to, next)) core.s = next
      }
      // Every workspace's stored leaves are read: this session's, and all of them at boot.
      if (L.canRequest(core.s, media, workspace, to.loaded && core.booting?.size === 0)) {
        const intent = core.s.wanted
        core.s = L.requestJoin(core.s)
        yield* Effect.forkIn(join(core, to, intent), to.work)
      }
    }
    yield* followStatus(core, to)
    yield* settleWaiters(core)
    yield* publish(core)
  })

/** Runs `change` under the lock, then `drive`. */
export function step<A, E>(core: Core, change: Effect.Effect<A, E>): Effect.Effect<A, E> {
  return core.lock.withPermits(1)(change.pipe(Effect.ensuring(drive(core))))
}

export const start = Effect.fn('Huddle.start')(function* (core: Core, channelId: string, region: string | null, generation: number, connection: number) {
  const deferred = yield* Deferred.make<HuddleStartResult, HuddleError>()
  const waiter = yield* step(core, Effect.gen(function* () {
    if (core.attached === undefined) return yield* new Offline()
    // A page main counts as gone cannot run media. One above the highest it gave out waits for main.
    if (pageState(view(core), generation) === 'gone') {
      yield* Deferred.succeed(deferred, { _tag: 'cancelled' })
      return undefined
    }
    const ticket = ++core.tickets
    const waiter: Waiter = { deferred, connection, state: 'waiting' }
    core.waiters.set(ticket, waiter)
    core.s = L.choose(core.s, { channelId, region, generation, ticket })
    return waiter
  }))
  // The caller went (its RPC was cancelled or its connection closed): its answer would reach no page, so the join
  // hands it to none. At once and without the lock, so it holds even while an answer is being stored.
  return yield* Deferred.await(deferred).pipe(Effect.onInterrupt(() => Effect.sync(() => {
    if (waiter !== undefined && waiter.state === 'waiting') waiter.state = 'cancelled'
  })))
})

export const leave = (core: Core) =>
  step(core, Effect.sync(() => {
    core.s = L.leave(core.s)
  }))

/** A page's whole media state, on engine connection `connection`. The one with the highest `seq` wins, whatever order they come in; a page main counts as gone is ignored. */
export const report = (core: Core, next: HuddlePageReport, connection: number) =>
  step(core, Effect.sync(() => {
    const known = core.reports.get(next.generation)
    if (pageState(view(core), next.generation) !== 'gone' && (known === undefined || next.seq > known.report.seq)) core.reports.set(next.generation, { report: next, connection })
  }))

/** Main's report of the live page generations and the highest it gave out. */
export const pages = (core: Core, live: ReadonlyArray<number>, maxIssued: number) =>
  step(core, Effect.sync(() => {
    core.pages.reported = true
    core.pages.live = new Set(live)
    core.pages.maxIssued = Math.max(core.pages.maxIssued, maxIssued)
    for (const generation of core.reports.keys()) if (pageState(view(core), generation) === 'gone') core.reports.delete(generation)
  }))
