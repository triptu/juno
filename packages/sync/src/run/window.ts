import { quietDaysOf } from '@juno/domain'
import { liveQuery, prefs } from '@juno/store'
import { Effect, Result, Stream } from 'effect'
import { backfillWindow } from '../window'
import { bootState } from '../boot'
import type { SyncRuntime } from './runtime'

/** A decrease cancels queued backfill. A later increase reuses completed coverage. */
export const watchWindow = (runtime: SyncRuntime) => {
  const { ctx, state, work, config } = runtime
  const changes = liveQuery(['prefs'], prefs.get<unknown>('quietDays')).pipe(
    Stream.filter(Result.isSuccess),
    Stream.map((result) => quietDaysOf({ now: 0, quietDays: typeof result.success === 'number' ? result.success : config.quietDays })),
    Stream.changes,
    Stream.map((days) => {
      const raised = days > ctx.config.quietDays
      ctx.config = { ...ctx.config, quietDays: days }
      return raised
    }),
  )
  return changes.pipe(
    Stream.switchMap((raised) => raised ? Stream.fromEffect(Effect.gen(function* () {
      while (true) {
        if (!state.booted || !state.connected) {
          yield* Effect.sleep(100)
          continue
        }
        const attempt = Effect.gen(function* () {
          yield* backfillWindow(ctx)
          state.lastBoot = yield* bootState()
        })
        const result = yield* Effect.result(runtime.cycle(attempt.pipe(work.withPermit)))
        if (result._tag === 'Success') return
        if (result.failure._tag === 'SlackAuthRequired') return yield* result.failure
        yield* Effect.logWarning('sync: window backfill failed, retrying', { tag: result.failure._tag })
        yield* Effect.sleep(config.bootRetryMillis)
      }
    })) : Stream.empty),
    Stream.runDrain,
  )
}
