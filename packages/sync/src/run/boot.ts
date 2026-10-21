import { SlackAuthRequired } from '@juno/slack'
import { Clock, Deferred, Effect, Fiber, Scope } from 'effect'
import { backfillWindow } from '../window'
import { bootState, coldBoot, warmBoot } from '../boot'

import type { SyncFailure, SyncPhase, SyncServices } from '../sync'
import { followPassIfDue, repairAfterLive } from './reconcile'
import { isNotAuth, type SyncRuntime } from './runtime'

const bootOnce = (runtime: SyncRuntime) => {
  const { state, ctx, options, reportBoot, work } = runtime
  const openNow = options.openTopics ?? Effect.succeed([])
  return Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis
    const previous = yield* bootState()
    const threadsLoaded = previous === undefined
      ? yield* coldBoot(ctx, reportBoot)
      : (yield* warmBoot(ctx, previous, reportBoot, yield* openNow), true)
    if (previous !== undefined && (previous.quietDays === undefined || ctx.config.quietDays > previous.quietDays)) yield* backfillWindow(ctx)
    state.lastBoot = yield* bootState()
    // Both boots read the followed threads over the window and check the ones left out: a follow pass.
    state.lastFollowPass = threadsLoaded ? startedAt : undefined
    if (options.onBooted !== undefined) yield* options.onBooted
  }).pipe(work.withPermit)
}

const TAG = /^[A-Z][A-Za-z]{2,40}$/
const METHOD = /^[a-z]+(?:[./][a-zA-Z]+)+$/
const CODE = /^[a-z_]{1,64}$/

/**
 * The phase for a failed boot. Only a request that never got an answer (no
 * connection, DNS, a timeout: a transport error with no HTTP status) is
 * `offline`; anything else is `failed` with a reason safe to show and copy.
 */
export const bootFailure = (error: { readonly _tag: string }): SyncPhase => {
  const field = (key: string): unknown => Reflect.get(error, key)
  if (error._tag === 'SlackTransportError' && field('status') === undefined) return { _tag: 'offline' }
  const method = field('method')
  const code = error._tag === 'SlackRejected' ? field('error') : undefined
  const status = error._tag === 'SlackTransportError' ? field('status') : undefined
  const reason: SyncFailure = {
    error: TAG.test(error._tag) ? error._tag : 'Error',
    ...(typeof method === 'string' && METHOD.test(method) ? { method } : {}),
    ...(typeof code === 'string' && CODE.test(code) ? { detail: code } : typeof status === 'number' ? { detail: `HTTP ${status}` } : {}),
  }
  return { _tag: 'failed', reason }
}

export const makeBootLoop = (
  runtime: SyncRuntime,
  sweep: Effect.Effect<void, SlackAuthRequired, SyncServices | Scope.Scope>,
) => {
  const { state, config, cycle, phase, settle, refreshEmoji, refreshUsergroups } = runtime
  const attempt = bootOnce(runtime)
  /** A `force_reload`: boot again from the current store. */
  const reboot = cycle(attempt.pipe(
    Effect.andThen(settle),
    Effect.andThen(repairAfterLive(runtime)),
    Effect.andThen(refreshUsergroups),
    Effect.andThen(refreshEmoji),
    Effect.andThen(followPassIfDue(runtime)),
    Effect.catchIf(isNotAuth, (error) => Effect.logWarning('sync: reboot failed', { cause: error })),
  ))

  const initialize = cycle(Effect.gen(function* () {
    // User groups and emoji are methods of their own, so they are read beside the boot rather than after it: a cold boot
    // reads 30 or more emoji pages, which would keep the first sync running for another minute and a half (live, 10-17).
    const refreshes = yield* Effect.forkChild(Effect.all([refreshUsergroups, refreshEmoji], { concurrency: 2 }))
    while (true) {
      const result = yield* Effect.result(attempt)
      if (result._tag === 'Success') break
      const error = result.failure
      if (error._tag === 'SlackAuthRequired') return yield* error
      yield* Effect.logWarning('sync: boot failed, retrying', { cause: error })
      const wake = yield* Deferred.make<void>()
      state.bootRetry = wake
      yield* phase(bootFailure(error)).pipe(
        Effect.andThen(Effect.raceFirst(Effect.sleep(config.bootRetryMillis), Deferred.await(wake))),
        Effect.ensuring(Effect.sync(() => { state.bootRetry = undefined })),
      )
    }
    state.booted = true
    yield* settle()
    yield* repairAfterLive(runtime)
    // One that failed beside a boot that had to retry is read again now.
    const [usergroups, emoji] = yield* Fiber.join(refreshes)
    if (!usergroups) yield* refreshUsergroups
    if (!emoji) yield* refreshEmoji
    yield* followPassIfDue(runtime)
  }))

  const bootLoop = Effect.gen(function* () {
    yield* initialize
    if (config.sweepIntervalMillis === 0) return yield* Effect.never
    // The periodic discovery sweep while live.
    while (true) {
      yield* Effect.sleep(config.sweepIntervalMillis)
      if (!state.connected) continue
      yield* sweep
    }
  })
  return { reboot, bootLoop }
}
