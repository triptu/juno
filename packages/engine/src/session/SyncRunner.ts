/**
 * Runs `@juno/sync` for every ready session (architecture 16 M3).
 *
 * The runner watches the session. When it becomes ready it forks `runSync`
 * into the session's scope with the session's Slack context and the open
 * workspace's store, so the sync ends with the session (sign-out, a new
 * sign-in, `authRequired`). A sync that fails with `SlackAuthRequired`
 * (from the socket, the boot, a catch-up or the sweep) is reported back to
 * the session as `expire`, from a fiber outside the session scope so the
 * scope can close.
 *
 * The boot window is the user's quiet window (the `quietDays` pref, the
 * same one the sidebar reads), observed by the sync while it runs. The
 * engine uses the production sync schedule against both Slack and the fake;
 * focused tests override it through `SyncControl`.
 *
 * `phases` is the sync's phase while one runs, `undefined` otherwise,
 * `syncing` says whether one of its cycles is running, and `slowedUntil`
 * when Slack's rate limits hold the session's client back; the composition
 * layer folds them into `engine.status`. While a sync runs, its
 * fetcher for opened topics is in `SyncLink`, and the topics `SyncLink`
 * lists as shown are fetched again after each reconnect.
 */
import { Cause, Context, Effect, Fiber, Layer, Stream, SubscriptionRef } from 'effect'
import { RequestQueue } from '@juno/slack'
import { AiProvider } from '@juno/ai'
import { HOLD_MILLIS, holdUndecided, releaseHolds, sortAndRelease, sortClearCases } from '../automatedView'
import { OwnerActivity, startActivity } from '../activity'
import { NotificationControl, startNotifications } from '../notificationRuntime'
import type { SlackAuthRequired } from '@juno/slack'
import { runSync, syncConfigLayer, type SyncPhase } from '@juno/sync'
import { SyncControl } from '../config'
import { Session, type ActiveSession } from './Session'
import { SyncLink } from '../syncLink'
import { Workspace } from '../workspace'

export class SyncRunner extends Context.Service<
  SyncRunner,
  {
    readonly current: Effect.Effect<SyncPhase | undefined>
    readonly phases: Stream.Stream<SyncPhase | undefined>
    /** Whether a cycle of the running sync (boot, catch-up or sweep, with its follow pass) is running: at subscribe time, then every change. */
    readonly syncing: Stream.Stream<boolean>
    /** Until when a rate limit holds the running session's client back (`RequestQueue.slowedUntil`): at subscribe time, then every change. */
    readonly slowedUntil: Stream.Stream<number | undefined>
  }
>()('juno/engine/SyncRunner') {
  static readonly layer: Layer.Layer<SyncRunner, never, Session | Workspace | SyncLink | AiProvider | NotificationControl | OwnerActivity> = Layer.effect(
    SyncRunner,
    Effect.gen(function* () {
      const session = yield* Session
      const workspace = yield* Workspace
      const control = yield* SyncControl
      const link = yield* SyncLink
      // The host hears it too: tests compare it with the fake's socket.
      const setOnline = (online: boolean) => link.setOnline(online).pipe(Effect.andThen(Effect.sync(() => control.onConnection?.(online))))
      const scope = yield* Effect.scope
      const phase = yield* SubscriptionRef.make<SyncPhase | undefined>(undefined)
      const syncing = yield* SubscriptionRef.make(false)
      const slowed = yield* SubscriptionRef.make<number | undefined>(undefined)
      let running: { readonly active: ActiveSession; readonly fiber: Fiber.Fiber<never, SlackAuthRequired> } | undefined

      const stop = Effect.gen(function* () {
        const current = running
        running = undefined
        if (current !== undefined) yield* Fiber.interrupt(current.fiber)
        yield* link.setFetcher(undefined)
        yield* setOnline(false)
        yield* SubscriptionRef.set(phase, undefined)
        yield* SubscriptionRef.set(syncing, false)
        yield* SubscriptionRef.set(slowed, undefined)
      })

      const start = (active: ActiveSession) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* Effect.logWarning('sync: no workspace open for the ready session')
          // Cycles can overlap (a reconnect's catch-up during a sweep): syncing until the last one ends.
          // Counted per run; `stop` waits for an interrupted run's cycles to end before the next starts.
          let cycles = 0
          const countCycle = (event: 'started' | 'finished') =>
            Effect.suspend(() => {
              cycles += event === 'started' ? 1 : -1
              return SubscriptionRef.set(syncing, cycles > 0)
            })
          const program = Effect.gen(function* () {
            const { onEvent, onSelfPresence } = yield* startNotifications
            const activity = yield* startActivity
            return yield* runSync({
              onEvent: (event, me) => onEvent(event, me).pipe(Effect.andThen(activity.onEvent(event))),
              onSelfPresence,
              onCycle: (event) =>
                (event === 'finished' ? link.caughtUp : Effect.void).pipe(
                  Effect.andThen(countCycle(event)),
                  Effect.andThen(Effect.sync(() => control.onCycle?.(event))),
                ),
              onPhase: (next) => SubscriptionRef.set(phase, next),
              onConnection: setOnline,
              // The topic view's fetches run in this sync's context while it lives.
              onFetcher: (fetcher) => link.setFetcher(fetcher),
              openTopics: link.shown,
              // Clear bot channels are in Automated before the sync reports live (SPEC 5, "Automated"); nothing stays held after.
              onBooted: sortClearCases().pipe(Effect.andThen(releaseHolds), Effect.provide(open.context), Effect.catch((error) => Effect.logWarning('sync: Automated not sorted', error))),
              // The first sync's All waits for the rules: undecided channels are held until their history is sorted, for HOLD_MILLIS at most.
              onListed: holdUndecided.pipe(
                Effect.andThen(Effect.forkIn(Effect.sleep(HOLD_MILLIS).pipe(Effect.andThen(releaseHolds)), active.scope)),
                Effect.provide(open.context),
                Effect.asVoid,
                Effect.catch((error) => Effect.logWarning('sync: Automated holds not set', error)),
              ),
              onHistory: (channel) => sortAndRelease(channel).pipe(Effect.provide(open.context), Effect.catch((error) => Effect.logWarning('sync: Automated not sorted', error))),
            })
          }).pipe(
            Effect.provide(active.context),
            Effect.provide(open.context),
            Effect.provide(
              syncConfigLayer({
                ...control.config,
              }),
            ),
            Effect.scoped,
          )
          const fiber = yield* Effect.forkIn(program, active.scope)
          running = { active, fiber }
          yield* Effect.forkIn(
            Stream.runForEach(Context.get(active.context, RequestQueue).slowedUntil, (until) => SubscriptionRef.set(slowed, until)),
            active.scope,
          )
          // Outside the session scope: a fatal auth condition ends the session, which closes the scope this fiber lives in.
          yield* Effect.forkIn(
            Effect.gen(function* () {
              const exit = yield* Effect.exit(Fiber.join(fiber))
              if (running?.fiber === fiber) {
                running = undefined
                yield* link.setFetcher(undefined)
                yield* setOnline(false)
                yield* SubscriptionRef.set(syncing, false)
              }
              if (exit._tag === 'Failure') {
                const error = Cause.findErrorOption(exit.cause)
                if (error._tag === 'Some') yield* session.expire(error.value.error)
                else if (!Cause.hasInterruptsOnly(exit.cause)) yield* Effect.logError('sync ended unexpectedly', { cause: exit.cause })
              }
              yield* SubscriptionRef.set(phase, undefined)
            }),
            scope,
          )
        })

      yield* Effect.forkIn(
        Stream.runForEach(session.statuses, (status) =>
          Effect.gen(function* () {
            const active = status._tag === 'ready' ? yield* session.active.pipe(Effect.option) : undefined
            const next = active?._tag === 'Some' ? active.value : undefined
            if (running !== undefined && running.active === next) return
            yield* stop
            if (next !== undefined) yield* start(next)
          }),
        ),
        scope,
      )

      return SyncRunner.of({
        current: SubscriptionRef.get(phase),
        phases: SubscriptionRef.changes(phase),
        syncing: SubscriptionRef.changes(syncing),
        slowedUntil: SubscriptionRef.changes(slowed),
      })
    }),
  )
}
