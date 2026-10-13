/**
 * `runSync`: the whole sync for one session, running until interrupted.
 *
 * It opens the socket first (so nothing during backfill is lost), then boots
 * cold or warm, then stays live: every socket event is one transaction, a
 * reconnect runs the catch-up of architecture 5.8, and a discovery sweep
 * runs every `sweepIntervalMillis`. After the boot, and then with a catch-up
 * or sweep at most every `followPassMillis`, the complete pass over the
 * followed threads runs (`followPass`). Boot, catch-up, sweep and that pass
 * share one permit so two never interleave; events never wait for them.
 *
 * Failures: a fatal auth condition from the socket or from any call, boot,
 * catch-up, sweep or root fetch included, fails the effect with
 * `SlackAuthRequired` and the engine ends the session. Any other boot
 * failure is logged and retried after `bootRetryMillis` with the phase at
 * `offline`; any other catch-up failure is logged and the phase settles. A
 * store error is a bug; it is logged per event so one bad frame does not
 * end the sync, and surfaces in the engine log.
 */
import { millisToTs, type Ts } from '@juno/domain'
import { SlackApi, SlackAuthRequired, SlackEdge, SlackSession, SlackSocket, type SocketEvent } from '@juno/slack'
import { Invalidation, StoreReader, StoreWriter, transaction } from '@juno/store'
import { Clock, Effect, FiberSet, Queue, Scope, Semaphore } from 'effect'
import { Stream } from 'effect'
import { bootState, catchUp, coldBoot, followPass, warmBoot, type BootState, type Phase } from './boot'
import { SyncConfig } from './config'
import type { RootFetch, SyncContext } from './context'
import { applyFrame } from './events'
import { applyPage } from './pages'
import { clearPendingFollows, endEventCoverage } from './write'

export type SyncPhase =
  | { readonly _tag: 'booting' }
  | { readonly _tag: 'catching-up'; readonly done: number; readonly total: number }
  | { readonly _tag: 'live' }
  | { readonly _tag: 'offline' }

export interface RunSyncOptions {
  /** Called on every phase change. */
  readonly onPhase: (phase: SyncPhase) => Effect.Effect<void>
}

export type SyncServices = SlackApi | SlackEdge | SlackSocket | SlackSession | StoreWriter | StoreReader | Invalidation

const isNotAuth = <E extends { readonly _tag: string }>(error: E): error is Exclude<E, SlackAuthRequired> => error._tag !== 'SlackAuthRequired'

export const runSync = (options: RunSyncOptions): Effect.Effect<never, SlackAuthRequired, SyncServices | Scope.Scope> =>
  Effect.gen(function* () {
    const config = yield* SyncConfig
    const session = yield* SlackSession
    const socket = yield* SlackSocket
    const ctx: SyncContext = {
      me: { userId: session.userId as SyncContext['me']['userId'] },
      config,
      rootFetches: yield* Queue.unbounded<RootFetch>(),
      missingUsers: new Map(),
      unknownUsers: new Set(),
      lateReactions: new Map(),
    }
    const state = { connected: false, booted: false, lastBoot: undefined as BootState | undefined, lastFollowPass: undefined as number | undefined }
    const work = yield* Semaphore.make(1)
    const phase = options.onPhase
    const settle = () => phase(state.connected ? { _tag: 'live' } : { _tag: 'offline' })
    const reportBoot: Phase = phase
    // Catch-ups and reboots run in the background; joining the set below is what lets their auth failures end the sync.
    const background = yield* FiberSet.make<void, SlackAuthRequired>()

    // No command is in flight before the sync runs; `follow` outbox rows are left over from a crash.
    yield* transaction(clearPendingFollows).pipe(Effect.catchCause((cause) => Effect.logError('sync: pending follows not cleared', { cause })))
    const events = yield* socket.events

    /**
     * The complete pass over the followed threads (`followPass`), when the
     * last one started more than `followPassMillis` ago. After the phase has
     * settled: it runs on the background lane and can take minutes.
     */
    const followPassIfDue = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      if (state.lastFollowPass !== undefined && now - state.lastFollowPass < config.followPassMillis) return
      yield* followPass(ctx)
      state.lastFollowPass = now
    }).pipe(
      work.withPermit,
      Effect.catchIf(isNotAuth, (error) => Effect.logWarning('sync: follow pass failed', { tag: error._tag })),
    )

    /** The catch-up after a reconnect, under the work permit, then the follow pass if it is due. */
    const reconcile = Effect.gen(function* () {
      const previous = state.lastBoot ?? (yield* bootState())
      if (previous === undefined) return
      yield* catchUp(ctx, previous, reportBoot, { refreshWorkspace: false, refreshThreads: true })
      state.lastBoot = yield* bootState()
    }).pipe(
      work.withPermit,
      Effect.tapError((error) => Effect.logWarning('sync: catch-up failed', { tag: error._tag })),
      Effect.andThen(settle),
      Effect.catchIf(isNotAuth, () => settle()),
      Effect.andThen(followPassIfDue),
    )

    const handle = (event: SocketEvent): Effect.Effect<void, never, SyncServices | Scope.Scope> => {
      switch (event._tag) {
        case 'Connected':
          state.connected = true
          return state.booted ? FiberSet.run(background, reconcile).pipe(Effect.asVoid) : Effect.void
        case 'Disconnected':
          state.connected = false
          if (!state.booted) return Effect.void
          return transaction(endEventCoverage).pipe(
            Effect.catchCause((cause) => Effect.logError('sync: coverage not reset', { cause })),
            Effect.andThen(phase({ _tag: 'offline' })),
          )
        case 'Frame':
          if (event.frame.type === 'force_reload') return FiberSet.run(background, reboot).pipe(Effect.asVoid)
          return applyFrame(ctx, event.frame).pipe(
            Effect.catchCause((cause) => Effect.logError('sync: event not applied', { type: event.frame.type, cause })),
          )
      }
    }

    const consumer = Stream.runForEach(events, handle)

    const bootOnce = Effect.gen(function* () {
      const previous = yield* bootState()
      if (previous === undefined) yield* coldBoot(ctx, reportBoot)
      else yield* warmBoot(ctx, previous, reportBoot)
      state.lastBoot = yield* bootState()
    }).pipe(work.withPermit)

    /** A `force_reload`: boot again from the current store. */
    const reboot = bootOnce.pipe(
      Effect.andThen(settle),
      Effect.andThen(followPassIfDue),
      Effect.catchIf(isNotAuth, (error) => Effect.logWarning('sync: reboot failed', { tag: error._tag })),
    )

    const bootLoop = Effect.gen(function* () {
      while (true) {
        const result = yield* Effect.result(bootOnce)
        if (result._tag === 'Success') break
        const error = result.failure
        if (error._tag === 'SlackAuthRequired') return yield* error
        yield* Effect.logWarning('sync: boot failed, retrying', { tag: error._tag })
        yield* phase({ _tag: 'offline' })
        yield* Effect.sleep(config.bootRetryMillis)
      }
      state.booted = true
      yield* settle()
      yield* followPassIfDue
      // The periodic discovery sweep while live.
      while (true) {
        yield* Effect.sleep(config.sweepIntervalMillis)
        if (!state.connected) continue
        yield* reconcile
      }
    })

    const fetchRoots = Effect.gen(function* () {
      const api = yield* SlackApi
      while (true) {
        const { channel, ts } = yield* Queue.take(ctx.rootFetches)
        const requestedAt = yield* Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now))
        const result = yield* Effect.result(
          api.call('conversations.replies', { channel, ts: ts as Ts, oldest: ts, inclusive: true, limit: 1 }, { lane: 'background', reason: 'root' }),
        )
        if (result._tag === 'Failure') {
          if (result.failure._tag === 'SlackAuthRequired') return yield* result.failure
          yield* Effect.logDebug('sync: root fetch failed', { tag: result.failure._tag })
          continue
        }
        // The root carries `subscribed` and `last_read`, so a thread older than the window is a row as soon as it is followed.
        yield* applyPage(ctx, channel, result.success.messages, { kind: 'page', requestedAt }).pipe(
          Effect.catchCause((cause) => Effect.logError('sync: root not applied', { cause })),
        )
      }
    })

    yield* Effect.all([consumer, bootLoop, fetchRoots, FiberSet.join(background)], { concurrency: 'unbounded', discard: true })
    return yield* Effect.never
  })
