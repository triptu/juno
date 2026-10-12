/**
 * Handlers for the session routes. The live value re-runs on every status
 * change with no debounce; the commands run on the `Session` service and
 * return once the session is verified (or fail with `SignInFailed`).
 */
import { Effect, Stream } from 'effect'
import { SessionRoutes } from '@juno/contract'
import { EngineConfig } from '../config'
import { serveLiveValue, timed } from '../protocol/live'
import { Session } from './Session'

export const SessionHandlers = SessionRoutes.toLayer(
  Effect.gen(function* () {
    const session = yield* Session
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev
    return {
      'session.status': () => serveLiveValue(session.statuses.pipe(Stream.mapEffect(() => Effect.result(timed(session.status)))), { measure }),
      'session.signIn': () => session.signIn('window'),
      'session.importFromSlackApp': () => session.signIn('import'),
      'session.signOut': () => session.signOut,
    }
  }),
)
