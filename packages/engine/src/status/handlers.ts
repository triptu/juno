/**
 * Handlers for the engine routes. This is the pattern for every feature
 * folder: `<Feature>Routes.toLayer({...})`, one entry per route, live queries
 * built with the helpers in `protocol/live.ts`, services from `yield*`.
 */
import { Clock, Effect, Schedule, Stream } from 'effect'
import { EngineRoutes } from '@juno/contract'
import { liveValue } from '../protocol/live'
import { Status } from './Status'

/** Uptime ticks once a second so the renderer can show it without a timer of its own. */
const UPTIME_TICK = '1 second'

export const StatusHandlers = EngineRoutes.toLayer(
  Effect.gen(function* () {
    const status = yield* Status
    return {
      'engine.status': () =>
        liveValue({
          query: status.current,
          invalidations: Stream.merge(status.phaseChanges, Stream.fromSchedule(Schedule.spaced(UPTIME_TICK))),
        }),
      'engine.ping': ({ n }) => Clock.currentTimeMillis.pipe(Effect.map((at) => ({ pong: n + 1, at }))),
    }
  }),
)
