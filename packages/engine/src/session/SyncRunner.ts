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
 * same one the sidebar reads), read when the sync starts. Against the fake
 * (`EngineConfig.fakeSlackUrl`) the complete follow pass runs with every
 * catch-up instead of hourly.
 *
 * `phases` is the sync's phase while one runs, `undefined` otherwise; the
 * composition layer folds it into `engine.status`.
 */
import { Cause, Context, Effect, Fiber, Layer, Stream, SubscriptionRef } from 'effect'
import { quietDaysOf } from '@juno/domain'
import type { SlackAuthRequired } from '@juno/slack'
import { prefs } from '@juno/store'
import { runSync, syncConfigLayer, type SyncPhase } from '@juno/sync'
import { EngineConfig } from '../config'
import { Session, type ActiveSession } from './Session'
import { Workspace } from '../workspace'

export class SyncRunner extends Context.Service<
  SyncRunner,
  {
    readonly current: Effect.Effect<SyncPhase | undefined>
    readonly phases: Stream.Stream<SyncPhase | undefined>
  }
>()('juno/engine/SyncRunner') {
  static readonly layer: Layer.Layer<SyncRunner, never, Session | Workspace | EngineConfig> = Layer.effect(
    SyncRunner,
    Effect.gen(function* () {
      const session = yield* Session
      const workspace = yield* Workspace
      const engineConfig = yield* EngineConfig
      const scope = yield* Effect.scope
      const phase = yield* SubscriptionRef.make<SyncPhase | undefined>(undefined)
      let running: { readonly active: ActiveSession; readonly fiber: Fiber.Fiber<never, SlackAuthRequired> } | undefined

      const stop = Effect.gen(function* () {
        const current = running
        running = undefined
        if (current !== undefined) yield* Fiber.interrupt(current.fiber)
        yield* SubscriptionRef.set(phase, undefined)
      })

      const start = (active: ActiveSession) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* Effect.logWarning('sync: no workspace open for the ready session')
          const quietDays = yield* prefs.get<unknown>('quietDays').pipe(
            Effect.provide(open.context),
            Effect.catch(() => Effect.succeed(undefined)),
          )
          const program = runSync({ onPhase: (next) => SubscriptionRef.set(phase, next) }).pipe(
            Effect.provide(active.context),
            Effect.provide(open.context),
            Effect.provide(
              syncConfigLayer({
                quietDays: quietDaysOf({ now: 0, ...(typeof quietDays === 'number' ? { quietDays } : {}) }),
                // Against the fake the complete follow pass runs with every catch-up, so tests see it each time.
                ...(engineConfig.fakeSlackUrl === undefined ? {} : { followPassMillis: 0 }),
              }),
            ),
            Effect.scoped,
          )
          const fiber = yield* Effect.forkIn(program, active.scope)
          running = { active, fiber }
          // Outside the session scope: a fatal auth condition ends the session, which closes the scope this fiber lives in.
          yield* Effect.forkIn(
            Effect.gen(function* () {
              const exit = yield* Effect.exit(Fiber.join(fiber))
              if (running?.fiber === fiber) running = undefined
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

      return SyncRunner.of({ current: SubscriptionRef.get(phase), phases: SubscriptionRef.changes(phase) })
    }),
  )
}
