import { SlackAuthRequired } from '@juno/slack'
import { Clock, Effect, FiberSet, Scope } from 'effect'
import { repairMutations } from '../mutationRepair'
import { bootState, catchUp, followPass } from '../boot'
import { fetchTopic, type FetchReport } from '../open'
import { wantUsers } from '../users'

import type { SyncServices } from '../sync'
import { isNotAuth, type SyncRuntime } from './runtime'

/** After a reconnect or a sweep: what changed in the open topics while the socket was down. */
const refreshOpenTopics = (runtime: SyncRuntime) => Effect.gen(function* () {
  const { options, ctx } = runtime
  const nameSenders = (report: FetchReport) => Effect.sync(() => wantUsers(ctx, report.unknownUsers))
  const open = options.openTopics === undefined ? [] : yield* options.openTopics
  for (const topicId of open) {
    // Not asked for by the user: it yields to their opens and jumps.
    yield* fetchTopic(ctx, topicId, 'paging').pipe(
      Effect.tap(nameSenders),
      Effect.catchIf(isNotAuth, (error) => Effect.logWarning('sync: open topic not refreshed', { cause: error })),
    )
  }
})

/**
 * The pass over the followed threads of the window (`followPass`), when
 * the last one (a boot counts) started more than `followPassMillis` ago.
 * After the phase has settled: it runs on the background lane.
 */
export const followPassIfDue = (runtime: SyncRuntime) => {
  const { state, config, ctx, work, step } = runtime
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    if (state.lastFollowPass !== undefined && now - state.lastFollowPass < config.followPassMillis) return
    yield* step('follow-pass', followPass(ctx))
    state.lastFollowPass = now
  }).pipe(
    work.withPermit,
    Effect.catchIf(isNotAuth, (error) => Effect.logWarning('sync: follow pass failed', { cause: error })),
  )
}

/**
 * A failed catch-up is tried again while the socket stays up: after the
 * rate limit that stopped it, else after `bootRetryMillis`. At most one
 * retry waits; a reconnect in between catches up anyway.
 */
const makeCatchUpRetry = (runtime: SyncRuntime, reconcile: Effect.Effect<void, SlackAuthRequired, SyncServices | Scope.Scope>) => {
  const { state, config, background } = runtime
  let retryWaiting = false
  return (error: { readonly _tag: string; readonly retryAfterMillis?: number }) =>
    Effect.suspend(() => {
      if (retryWaiting) return Effect.void
      retryWaiting = true
      const delay = error._tag === 'SlackRateLimited' && error.retryAfterMillis !== undefined ? error.retryAfterMillis : config.bootRetryMillis
      return FiberSet.run(
        background,
        Effect.sleep(delay).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              retryWaiting = false
              return state.connected ? reconcile : Effect.void
            }),
          ),
        ),
      ).pipe(Effect.asVoid)
    })
}

/** Rechecks a captured socket gap; a failure restores it without losing a later drop. */
const catchUpAfterGap = (runtime: SyncRuntime) => Effect.gen(function* () {
  const { state, ctx, options, reportBoot } = runtime
  const openNow = options.openTopics ?? Effect.succeed([])
  const previous = state.lastBoot ?? (yield* bootState())
  if (previous === undefined) return
  const droppedAt = state.droppedAt
  state.droppedAt = undefined
  const recheck = droppedAt === undefined ? undefined : { since: droppedAt, first: yield* openNow }
  const next = yield* catchUp(ctx, previous, reportBoot, {
    refreshWorkspace: false,
    refreshMetadata: droppedAt !== undefined,
    refreshThreads: true,
    persistState: droppedAt !== undefined,
    observeSweepMarkers: (entries) => Effect.suspend(() => state.connected && state.droppedAt === undefined
      ? state.markerCandidates.observe(entries) : Effect.void),
    ...(recheck === undefined ? {} : { recheck }),
  }).pipe(
    Effect.tapError(() =>
      Effect.sync(() => {
        if (droppedAt !== undefined) state.droppedAt = Math.min(droppedAt, state.droppedAt ?? droppedAt)
      }),
    ),
  )
  state.lastBoot = next
  yield* refreshOpenTopics(runtime)
})

export const repairAfterLive = (runtime: SyncRuntime) => repairMutations(runtime.ctx).pipe(
  runtime.work.withPermit,
  Effect.catchIf(isNotAuth, (error) => Effect.logWarning('sync: mutation repair deferred', { cause: error })),
)

export const makeReconcile = (runtime: SyncRuntime, name: 'catch-up' | 'sweep') => {
  const { cycle, work, settle, step } = runtime
  /**
   * The catch-up after a reconnect or a sweep, under the work permit, then
   * the follow pass if it is due. Reconnects refresh the incremental thread
   * last sync; the hourly full pass covers the whole quiet window. After
   * a drop it rechecks the gap; a drop during it is rechecked by the next
   * one, and a failure keeps the gap.
   */
  const reconcile: Effect.Effect<void, SlackAuthRequired, SyncServices | Scope.Scope> = cycle(step(name, catchUpAfterGap(runtime)).pipe(
    work.withPermit,
    Effect.tapError((error) => Effect.logWarning('sync: catch-up failed', { cause: error })),
    Effect.andThen(settle),
    Effect.catchIf(isNotAuth, (error) => settle().pipe(Effect.andThen(retryCatchUp(error)))),
    Effect.andThen(repairAfterLive(runtime)),
    Effect.andThen(followPassIfDue(runtime)),
  ))
  const retryCatchUp = makeCatchUpRetry(runtime, reconcile)
  return reconcile
}
