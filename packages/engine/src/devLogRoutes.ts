/**
 * `devLog.list` and `devLog.entry`: the developer log (`devLog.ts`) as the
 * page shows it. No store keys: both re-run on the log's own changes, at
 * most once per `THROTTLE_MILLIS`, so a burst of calls during a boot is one
 * message, not hundreds. The log is only read while a page subscribes.
 */
import { DEV_LOG_CAPACITY, DevLogRoutes } from '@juno/contract'
import { Effect, Stream } from 'effect'
import { EngineConfig } from './config'
import { DevLog } from './devLog'
import { serveLiveList, serveLiveValue, timed } from './protocol/live'

const THROTTLE_MILLIS = 150

export const DevLogHandlers = DevLogRoutes.toLayer(
  Effect.gen(function* () {
    const log = yield* DevLog
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev
    // The first tick runs at once; each later one waits out the throttle, and ticks meanwhile fold into it.
    const runs = <A>(read: () => A) => {
      let first = true
      return log.changes.pipe(
        Stream.mapEffect(() => {
          const run = Effect.result(timed(Effect.sync(read)))
          if (first) {
            first = false
            return run
          }
          return Effect.andThen(Effect.sleep(THROTTLE_MILLIS), run)
        }),
      )
    }
    return {
      'devLog.list': ({ filter, range }) => {
        const limit = Math.max(1, Math.min(DEV_LOG_CAPACITY, range.limit))
        return serveLiveList(runs(() => log.rows(filter, limit)), { measure, encodeRow: (row) => row })
      },
      'devLog.entry': ({ id }) => serveLiveValue(runs(() => log.detail(id)), { measure }),
    }
  }),
)
