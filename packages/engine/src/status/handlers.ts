/**
 * Handlers for the engine routes. This is the pattern for every feature
 * folder: `<Feature>Routes.toLayer({...})`, one entry per route, live queries
 * served with the helpers in `protocol/live.ts`, services from `yield*`.
 *
 * Feature handlers backed by the store pass `liveQuery(keys, timed(query))`
 * as the runs. Status has no store keys: it re-runs on its own changes,
 * with no debounce.
 */
import { Clock, Effect, Stream } from 'effect'
import { EngineRoutes } from '@juno/contract'
import { EngineConfig } from '../config'
import { serveLiveValue, timed } from '../protocol/live'
import { Status } from './Status'
import { Workspace } from '../workspace'
import { outboxCounts } from './outbox'

export const StatusHandlers = EngineRoutes.toLayer(
  Effect.gen(function* () {
    const status = yield* Status
    const config = yield* EngineConfig
    const workspace = yield* Workspace
    const measure = config.e2e || config.dev
    return {
      'engine.status': () =>
        serveLiveValue(status.changes.pipe(Stream.mapEffect(() => Effect.result(timed(status.current)))), { measure }),
      'engine.outbox': () => Effect.gen(function* () {
        const open = yield* workspace.current
        return open === undefined ? null : yield* outboxCounts.pipe(Effect.provide(open.context), Effect.orDie)
      }),
      'engine.ping': ({ n }) =>
        config.e2e && n < 0
          ? Effect.die(new Error(`engine.ping: negative n (${n}) is a defect under e2e`))
          : Clock.currentTimeMillis.pipe(Effect.map((at) => ({ pong: n + 1, at }))),
    }
  }),
)
