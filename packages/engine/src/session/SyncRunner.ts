/**
 * Runs `@juno/sync` for every ready session (architecture 16 M3).
 *
 * The runner watches the session. When it becomes ready it forks `runSync`
 * into the session's scope with the session's Slack context and the open
 * workspace's store, so the sync ends with the session (sign-out, a new
 * sign-in, `authRequired`). A sync that fails with `SlackAuthRequired` is
 * reported back to the session as `expire`, from a fiber outside the
 * session scope so the scope can close.
 *
 * `phases` is the sync's phase while one runs, `undefined` otherwise; the
 * composition layer folds it into `engine.status`.
 */
import { Cause, Context, Effect, Exit, Fiber, Layer, Stream, SubscriptionRef } from 'effect'
import { runSync, syncConfigLayer, type SyncPhase } from '@juno/sync'
import { Session, type ActiveSession } from './Session'
import { Workspace } from '../workspace'

export class SyncRunner extends Context.Service<
  SyncRunner,
  {
    readonly current: Effect.Effect<SyncPhase | undefined>
    readonly phases: Stream.Stream<SyncPhase | undefined>
  }
>()('juno/engine/SyncRunner') {
  static readonly layer: Layer.Layer<SyncRunner, never, Session | Workspace> = Layer.effect(
    SyncRunner,
    Effect.gen(function* () {
      const session = yield* Session
      const workspace = yield* Workspace
      const scope = yield* Effect.scope
      const phase = yield* SubscriptionRef.make<SyncPhase | undefined>(undefined)
      let running: { readonly active: ActiveSession; readonly fiber: Fiber.Fiber<never, unknown> } | undefined

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
          const program = runSync({ onPhase: (next) => SubscriptionRef.set(phase, next) }).pipe(
            Effect.provide(active.context),
            Effect.provide(open.context),
            Effect.provide(syncConfigLayer()),
            Effect.scoped,
          )
          const fiber = yield* Effect.forkIn(program, active.scope)
          running = { active, fiber }
          // Outside the session scope: a fatal auth condition ends the session, which closes the scope this fiber lives in.
          yield* Effect.forkIn(
            Effect.gen(function* () {
              const exit = yield* Effect.exit(Fiber.join(fiber))
              if (running?.fiber === fiber) running = undefined
              if (Exit.isFailure(exit)) {
                const error = Cause.findErrorOption(exit.cause)
                const reason = error._tag === 'Some' && isAuthRequired(error.value) ? error.value.error : undefined
                if (reason !== undefined) yield* session.expire(reason)
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

const isAuthRequired = (error: unknown): error is { readonly _tag: 'SlackAuthRequired'; readonly error: string } =>
  typeof error === 'object' && error !== null && (error as { _tag?: unknown })._tag === 'SlackAuthRequired'
