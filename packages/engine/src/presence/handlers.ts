/** Handlers for the presence route: the engine's in-memory presence, served as it changes. */
import { Effect, Result, Stream } from 'effect'
import { PresenceRoutes } from '@juno/contract'
import { EngineConfig } from '../config'
import { serveLiveValue } from '../protocol/live'
import { OthersPresence } from './service'

export const PresenceHandlers = PresenceRoutes.toLayer(
  Effect.gen(function* () {
    const presence = yield* OthersPresence
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev
    return {
      'presence.active': () => serveLiveValue(presence.active.pipe(Stream.map((value) => Result.succeed({ value, queryMs: 0 }))), { measure }),
    }
  }),
)
