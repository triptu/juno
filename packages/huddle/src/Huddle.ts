/**
 * The `Huddle` service: one user's call (specs/huddle.qnt, "Implementation
 * notes" in specs/README.md).
 *
 * Every change runs under one lock: the user's commands, the renderer's
 * media reports, `rooms.join` answers and socket inputs. After each, `drive`
 * does what the rules in `lifecycle.ts` call for: it sends `rooms.leave`
 * for every pending attendee that is not the current call's (never waiting
 * for the answer), deletes the stored record of each one that was sent and
 * stopped, and sends `rooms.join` once nothing is left to clean up.
 *
 * A `rooms.join` answer is stored as a pending leave (channel, call and
 * attendee) before anything else, and only then are the Chime credentials
 * handed to the caller of `start`. A cancelled answer is never handed out.
 * The join runs in the session's work scope, not the caller's fiber, so its
 * answer is handled even after a Leave or while the session closes.
 *
 * Slack I/O needs a session: the engine calls `attach` once per sync, with
 * that sync's Slack client and the open workspace's store. Attaching loads
 * the stored leaves first, so they go out before any new join. Detaching
 * (sign-out, quit) leaves the call, waits a little for a join in flight and
 * the leaves it sends, and keeps the stored records for the next session.
 *
 * Running huddles come from room frames and the edge `huddles/info`. A
 * connect, a reconnect or `Overflowed` makes every channel due for a read;
 * a room frame makes its own channel due. A read is dropped when a socket
 * gap, or a frame for that channel, came while it was out.
 */
import { Context, Data, Deferred, Effect, Layer, Queue, Result, Scope, Semaphore, Stream, SubscriptionRef } from 'effect'
import { NotSignedIn, Offline, RateLimited, Rejected, type HuddleCall, type HuddleError, type HuddleMediaEvent, type HuddleStartResult, type RunningHuddles } from '@juno/contract'
import { SlackApi, SlackEdge, type SlackApiError, type SocketEvent } from '@juno/slack'
import { EdgeHuddlesInfoOk, type HuddleInfo, type MethodOk } from '@juno/slack-schema'
import * as L from './lifecycle'
import { applyInfo, applyJoined, applyRoomFrame, decodeRoomFrame, toRunningHuddles, type Running } from './running'

/** The stored record failed to write: the credentials stay private and the attendee is left. */
export class HuddleStoreError extends Data.TaggedError('HuddleStoreError')<{ readonly cause: unknown }> {}

/** Where the pending leaves of the session's workspace are stored. `write` replaces the whole list. */
export interface LeaveStore {
  readonly read: Effect.Effect<ReadonlyArray<L.Identity>>
  readonly write: (records: ReadonlyArray<L.Identity>) => Effect.Effect<void, HuddleStoreError>
}

export interface HuddleSession {
  /** The session's Slack client. */
  readonly slack: Context.Context<SlackApi | SlackEdge>
  readonly leaves: LeaveStore
  /** The conversations to read running huddles for after a gap: the ones the user is in. */
  readonly channels: Effect.Effect<ReadonlyArray<string>>
}

/** A socket event, or the `SocketEvents` marker for events dropped while the subscriber fell behind. */
export type HuddleInput = SocketEvent | { readonly _tag: 'Overflowed' }

export type HuddleListener = (input: HuddleInput) => Effect.Effect<void>

/** How many channel ids one `huddles/info` call takes. The official client's chunk size was not recorded. */
export const INFO_CHUNK = 50
/** How long reads wait after the first change, so a burst of frames costs one read. */
export const INFO_DEBOUNCE_MILLIS = 150
/** At quit or sign-out, how long to wait for a join in flight and the leaves sent. Main kills the engine 3 s after `quit`. */
export const DETACH_WAIT_MILLIS = 2_000

/** Errors Slack gives for a leave that has nothing to do, or that this workspace does not use (`huddles_arch_v2`). */
const BENIGN_LEAVE_ERRORS = new Set(['feature_not_enabled', 'channel_not_found', 'room_not_found', 'invalid_channel_id', 'attendee_not_found'])

interface Info {
  connected: boolean
  /** Bumped by every socket gap (disconnect, reconnect, `Overflowed`). */
  gap: number
  dirtyAll: boolean
  readonly dirty: Set<string>
  /** Bumped per channel by each room frame. */
  readonly frameGen: Map<string, number>
  readonly wake: Queue.Queue<void>
}

interface Attached {
  readonly session: HuddleSession
  /** Joins, leaves and reads run here; it closes after the detach has waited for them. */
  readonly work: Scope.Closeable
  readonly info: Info
}

/**
 * Slack's error as the contract says it. A join answer Juno cannot read
 * is a bug, but the Start still needs an answer: it fails as `Rejected`
 * and is logged.
 */
const toHuddleError = (error: SlackApiError): Effect.Effect<HuddleError> => {
  switch (error._tag) {
    case 'SlackTransportError':
      return Effect.succeed(new Offline())
    case 'SlackRateLimited':
      return Effect.succeed(new RateLimited({ retryAfterMillis: error.retryAfterMillis }))
    case 'SlackRejected':
      return Effect.succeed(new Rejected({ code: error.error }))
    case 'SlackAuthRequired':
      return Effect.succeed(new NotSignedIn())
    case 'SlackDecodeError':
      return Effect.logError('huddle: rooms.join answered in a shape Juno cannot read', { message: error.message }).pipe(Effect.as(new Rejected({ code: 'unreadable_answer' })))
  }
}

const codeOf = (error: HuddleError): string => {
  switch (error._tag) {
    case 'Rejected':
      return error.code
    case 'RateLimited':
      return 'rate_limited'
    case 'Offline':
      return 'offline'
    case 'NotSignedIn':
      return 'not_signed_in'
  }
}

/** The identity and credentials of a join answer, or why there are none (the legacy calls-server answer has no `free_willy`). */
const joinedFrom = (channelId: string, answer: MethodOk<'rooms.join'>) => {
  const free = answer.call.free_willy
  const attendeeId = free?.attendee['AttendeeId']
  if (free === undefined || typeof attendeeId !== 'string') return undefined
  return { identity: { channelId, callId: answer.call.call_id, attendeeId }, credentials: { meeting: free.meeting, attendee: free.attendee } }
}

export class Huddle extends Context.Service<Huddle, {
  /** The current call: at subscribe time, then every change. */
  readonly call: Stream.Stream<HuddleCall>
  /** Running huddles by channel: at subscribe time, then every change. */
  readonly running: Stream.Stream<RunningHuddles>
  /** Start or join the huddle in `channelId`, leaving the current call first. Answers with the credentials once the leave is stored. */
  readonly start: (channelId: string, region: string | null) => Effect.Effect<HuddleStartResult, HuddleError>
  readonly leave: Effect.Effect<void>
  /** The renderer's report about its media session. */
  readonly media: (event: HuddleMediaEvent) => Effect.Effect<void>
  /** Gives the service a session until the calling scope closes, and returns the listener for its socket. */
  readonly attach: (session: HuddleSession) => Effect.Effect<HuddleListener, never, Scope.Scope>
}>()('juno/huddle/Huddle') {
  static readonly layer = Layer.effect(Huddle, Effect.gen(function* () {
    const lock = yield* Semaphore.make(1)
    let s: L.Lifecycle = L.initial
    let running: Running = new Map()
    let attached: Attached | undefined
    let tickets = 0
    let leavesInFlight = 0
    const waiters = new Map<number, Deferred.Deferred<HuddleStartResult, HuddleError>>()
    /** Attendees the renderer said stopped, for records a later session loads. */
    const stoppedAttendees = new Set<string>()
    /** The renderer said no session runs, and no credentials went out since. */
    let rendererIdle = false

    const toCall = (): HuddleCall => {
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
    const callRef = yield* SubscriptionRef.make(toCall())
    const runningRef = yield* SubscriptionRef.make<RunningHuddles>({})

    const publish = Effect.suspend(() => SubscriptionRef.set(callRef, toCall())).pipe(
      Effect.andThen(Effect.suspend(() => SubscriptionRef.set(runningRef, toRunningHuddles(running)))),
    )

    /** A Start whose intent is gone (replaced, left, evicted, quit) answers `cancelled`. */
    const settleWaiters = Effect.suspend(() => {
      const live = new Set([s.wanted?.ticket, s.request !== undefined && !s.cancel ? s.request.ticket : undefined])
      const done = [...waiters].filter(([ticket]) => !live.has(ticket))
      for (const [ticket] of done) waiters.delete(ticket)
      return Effect.forEach(done, ([, deferred]) => Deferred.succeed(deferred, { _tag: 'cancelled' }), { discard: true })
    })

    const sendLeave = (to: Attached, identity: L.Identity) =>
      SlackApi.use((api) =>
        api.call('rooms.leave', { channel_id: identity.channelId, call_id: identity.callId, attendee_id: identity.attendeeId, reason: 'user_initiated' }, { reason: 'calls-api/leaveRoom' }),
      ).pipe(
        Effect.provide(to.session.slack),
        Effect.asVoid,
        Effect.catch((error) =>
          error._tag === 'SlackRejected' && BENIGN_LEAVE_ERRORS.has(error.error)
            ? Effect.logDebug('huddle: rooms.leave had nothing to do', { error: error.error })
            : Effect.logWarning('huddle: rooms.leave failed', { error: error._tag === 'SlackRejected' ? error.error : error._tag })),
        Effect.ensuring(Effect.sync(() => { leavesInFlight -= 1 })),
      )

    const markDue = (to: Attached, channel: string | 'all') =>
      Effect.suspend(() => {
        if (channel === 'all') to.info.dirtyAll = true
        else to.info.dirty.add(channel)
        return Queue.offer(to.info.wake, undefined)
      })

    /** One join, in the work scope. The answer is handled under the lock even when its Start was cancelled. */
    const join = (to: Attached, intent: L.Intent) =>
      Effect.gen(function* () {
        const answer = yield* Effect.result(
          SlackApi.use((api) =>
            api.call('rooms.join', { channel_id: intent.channelId, ...(intent.region === null ? {} : { regions: [intent.region] }), multidevice: false }, { reason: 'calls-api/joinRoom', singleAttempt: true }),
          ).pipe(Effect.provide(to.session.slack)),
        )
        yield* step(answered(to, intent, answer))
      })

    const answered = (to: Attached, intent: L.Intent, answer: Result.Result<MethodOk<'rooms.join'>, SlackApiError>) =>
      Effect.gen(function* () {
        const waiter = waiters.get(intent.ticket)
        const joined = Result.isSuccess(answer) ? joinedFrom(intent.channelId, answer.success) : undefined
        if (joined === undefined) {
          const failure = Result.isFailure(answer) ? yield* toHuddleError(answer.failure) : new Rejected({ code: 'create_meeting_failed' })
          if (!s.cancel && waiter !== undefined) {
            waiters.delete(intent.ticket)
            yield* Deferred.fail(waiter, failure)
          }
          s = L.joinError(s, codeOf(failure))
          return
        }
        const { identity, credentials } = joined
        // The record is durable before the credentials leave this function (model `answerJoin`).
        const stored = yield* Effect.result(to.session.leaves.write([...s.pending.map((p) => p.identity), identity]))
        if (Result.isFailure(stored)) {
          yield* Effect.logError('huddle: the pending leave was not stored; leaving at once', { cause: stored.failure.cause })
          // Handled as a cancelled answer: never handed out, left at once, cleared from memory once sent.
          s = L.answerJoin({ ...s, cancel: true }, identity)
          if (waiter !== undefined) {
            waiters.delete(intent.ticket)
            yield* Deferred.die(waiter, stored.failure)
          }
          return
        }
        const cancelled = s.cancel
        s = L.answerJoin(s, identity)
        if (Result.isSuccess(answer)) running = applyJoined(running, identity.channelId, identity.callId, answer.success.huddle)
        yield* markDue(to, identity.channelId)
        if (cancelled || waiter === undefined) return
        waiters.delete(intent.ticket)
        rendererIdle = false
        yield* Deferred.succeed(waiter, { _tag: 'joined', channelId: identity.channelId, callId: identity.callId, attendeeId: identity.attendeeId, credentials })
      })

    /** What the rules call for after a change. Runs under the lock. */
    const drive = Effect.gen(function* () {
      const to = attached
      if (to !== undefined) {
        for (const identity of L.toSend(s)) {
          s = L.sendLeave(s, identity.attendeeId)
          leavesInFlight += 1
          yield* Effect.forkIn(sendLeave(to, identity), to.work)
        }
        const clear = L.toClear(s)
        if (clear.length > 0) {
          const next = L.clearLeave(s, new Set(clear.map((identity) => identity.attendeeId)))
          const written = yield* Effect.result(to.session.leaves.write(next.pending.map((p) => p.identity)))
          // Kept until the next change tries again; a repeated leave is harmless.
          if (Result.isFailure(written)) yield* Effect.logWarning('huddle: a sent leave was not cleared', { cause: written.failure.cause })
          else s = next
        }
        if (L.canRequest(s)) {
          const intent = s.wanted
          s = L.requestJoin(s)
          yield* Effect.forkIn(join(to, intent), to.work)
        }
      }
      yield* settleWaiters
      yield* publish
    })

    function step<A, E>(change: Effect.Effect<A, E>): Effect.Effect<A, E> {
      return lock.withPermits(1)(change.pipe(Effect.ensuring(drive)))
    }

    const start = Effect.fn('Huddle.start')(function* (channelId: string, region: string | null) {
      const waiter = yield* Deferred.make<HuddleStartResult, HuddleError>()
      yield* step(Effect.gen(function* () {
        if (attached === undefined) return yield* new Offline()
        const ticket = ++tickets
        waiters.set(ticket, waiter)
        s = L.choose(s, { channelId, region, ticket })
      }))
      return yield* Deferred.await(waiter)
    })

    const leave = step(Effect.sync(() => {
      s = L.leave(s)
    }))

    const media = (event: HuddleMediaEvent) =>
      step(Effect.sync(() => {
        switch (event._tag) {
          case 'started':
            s = L.mediaStarted(s, event.attendeeId)
            return
          case 'ended':
            stoppedAttendees.add(event.attendeeId)
            s = L.mediaEnded(s, event.attendeeId, event.reason)
            return
          case 'muted':
            s = L.mediaMuted(s, event.attendeeId, event.muted)
            return
          case 'idle':
            rendererIdle = true
            s = L.mediaIdle(s)
            return
        }
      }))

    /** Reads due channels while the socket is up. A read invalidated while out is dropped and done again. */
    const reader = (to: Attached) =>
      Effect.gen(function* () {
        const info = to.info
        let backoff = 1_000
        const retryLater = Effect.suspend(() => {
          const wait = backoff
          backoff = Math.min(backoff * 2, 60_000)
          return Effect.sleep(wait).pipe(Effect.andThen(Queue.offer(info.wake, undefined)))
        })
        while (true) {
          yield* Queue.take(info.wake)
          yield* Effect.sleep(INFO_DEBOUNCE_MILLIS)
          if (!info.connected || (!info.dirtyAll && info.dirty.size === 0)) continue
          const all = info.dirtyAll
          const ids = new Set(info.dirty)
          if (all) for (const channel of yield* to.session.channels) ids.add(channel)
          if (all && ids.size === 0) {
            // The first sync has not stored the conversations yet.
            yield* Effect.forkIn(retryLater, to.work)
            continue
          }
          info.dirtyAll = false
          info.dirty.clear()
          const gap = info.gap
          const gens = new Map([...ids].map((id) => [id, info.frameGen.get(id) ?? 0]))
          const chunks: Array<Array<string>> = []
          for (const id of ids) {
            if (chunks.length === 0 || chunks[chunks.length - 1]!.length >= INFO_CHUNK) chunks.push([])
            chunks[chunks.length - 1]!.push(id)
          }
          const answer = yield* Effect.result(Effect.forEach(chunks, (chunk) =>
            SlackEdge.use((edge) => edge.call('huddles/info', { channel_ids: chunk }, EdgeHuddlesInfoOk)).pipe(Effect.map((ok) => ok.huddles)),
          { concurrency: 2 }).pipe(Effect.provide(to.session.slack)))
          const putBack = Effect.sync(() => {
            if (all) info.dirtyAll = true
            for (const id of ids) info.dirty.add(id)
          })
          if (Result.isFailure(answer)) {
            yield* Effect.logWarning('huddle: huddles/info failed', { error: answer.failure._tag })
            yield* putBack
            yield* Effect.forkIn(retryLater, to.work)
            continue
          }
          backoff = 1_000
          yield* lock.withPermits(1)(Effect.gen(function* () {
            if (attached !== to) return
            // A gap while the read was out: the whole answer may predate what was lost (model `discardInfo`).
            if (gap !== info.gap || !info.connected) {
              yield* putBack
              return yield* Queue.offer(info.wake, undefined)
            }
            const fresh = [...ids].filter((id) => info.frameGen.get(id) === gens.get(id))
            for (const id of ids) if (!fresh.includes(id)) info.dirty.add(id)
            const huddles: ReadonlyArray<HuddleInfo> = answer.success.flat()
            let next = applyInfo(running, fresh, huddles)
            // A full read also drops channels the user is no longer in.
            if (all) for (const channel of next.keys()) if (!ids.has(channel)) next = applyInfo(next, [channel], [])
            running = next
            if (info.dirty.size > 0) yield* Queue.offer(info.wake, undefined)
            yield* publish
          }))
        }
      })

    const listener = (to: Attached): HuddleListener => (input) =>
      lock.withPermits(1)(Effect.gen(function* () {
        if (attached !== to) return
        const info = to.info
        switch (input._tag) {
          case 'Frame': {
            if (input.frame.type !== 'unknown') return
            const frame = decodeRoomFrame(input.frame.raw)
            if (frame === undefined) return
            // Model `roomFrame`: the running list may change and the channel is due for a read; the call never changes.
            info.frameGen.set(frame.channelId, (info.frameGen.get(frame.channelId) ?? 0) + 1)
            running = applyRoomFrame(running, frame)
            yield* markDue(to, frame.channelId)
            return yield* publish
          }
          case 'Connected':
            info.connected = true
            info.gap += 1
            return yield* markDue(to, 'all')
          case 'Disconnected':
            info.connected = false
            info.gap += 1
            return
          case 'Overflowed':
            info.gap += 1
            return yield* markDue(to, 'all')
        }
      }))

    /** Waits until `done` holds or `millis` pass. */
    const waitUntil = (done: () => boolean, millis: number) =>
      Effect.sleep(50).pipe(Effect.repeat({ until: done }), Effect.timeoutOption(millis), Effect.asVoid)

    const detach = (to: Attached) =>
      Effect.gen(function* () {
        // Model `quit`: no call and no queued join; the stored leaves go out now.
        yield* step(Effect.sync(() => {
          s = L.quit(s)
        }))
        // A join in flight is answered and cleaned up, if it answers in time.
        yield* waitUntil(() => s.request === undefined, DETACH_WAIT_MILLIS)
        yield* waitUntil(() => leavesInFlight === 0, DETACH_WAIT_MILLIS)
        yield* lock.withPermits(1)(Effect.gen(function* () {
          if (attached === to) attached = undefined
          // The records stay stored for this workspace's next session, which sends them again.
          s = { ...L.quit(s), request: undefined, cancel: false, pending: [] }
          running = new Map()
          yield* settleWaiters
          yield* publish
        }))
      })

    const attach = Effect.fn('Huddle.attach')(function* (session: HuddleSession) {
      const scope = yield* Effect.scope
      // Made before the detach is registered, so it closes after the detach has waited.
      const work = yield* Scope.fork(scope, 'sequential')
      const to: Attached = {
        session,
        work,
        info: { connected: false, gap: 0, dirtyAll: true, dirty: new Set(), frameGen: new Map(), wake: yield* Queue.sliding<void>(1) },
      }
      const stored = yield* session.leaves.read
      // Model `restart`: the stored leaves are pending before any join can be sent.
      yield* step(Effect.sync(() => {
        attached = to
        running = new Map()
        s = L.restart(s, stored, (attendeeId) => rendererIdle || stoppedAttendees.has(attendeeId))
      }))
      yield* Scope.addFinalizer(scope, detach(to))
      yield* Effect.forkIn(reader(to), work)
      return listener(to)
    })

    return Huddle.of({
      call: SubscriptionRef.changes(callRef),
      running: SubscriptionRef.changes(runningRef),
      start,
      leave,
      media,
      attach,
    })
  }))
}
