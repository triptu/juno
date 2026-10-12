/**
 * The app layer. Feature tracks add their handler layer to `Handlers` and
 * their services to `Services`; this file is otherwise edited only by the
 * milestone's integration task.
 */
import { Effect, Layer, Stream } from 'effect'
import type { EnginePhase, SessionStatus } from '@juno/contract'
import { SessionHandlers } from './session/handlers'
import { Session } from './session/Session'
import { StatusHandlers } from './status/handlers'
import { Status } from './status/Status'

/** The engine phase a session status implies (architecture 2.5 and 11). Boot phases come in M3. */
const phaseOf = (status: SessionStatus): EnginePhase =>
  status._tag === 'ready' ? { _tag: 'live' } : status._tag === 'authRequired' ? { _tag: 'session-expired' } : { _tag: 'first-run' }

/** Keeps `engine.status` in step with the session for the life of the app. */
const SessionPhase = Layer.effectDiscard(
  Effect.gen(function* () {
    const session = yield* Session
    const status = yield* Status
    yield* Effect.forkScoped(Stream.runForEach(session.statuses, (value) => status.setPhase(phaseOf(value))))
  }),
)

/** Everything the route handlers need. Requires the host seams (`HostLink`, `HttpTransport`) and `EngineConfig`. */
export const Services = SessionPhase.pipe(Layer.provideMerge(Session.layer), Layer.provideMerge(Status.layer))

/** One `toLayer` per feature, merged. Requires `Services`. */
export const Handlers = Layer.mergeAll(StatusHandlers, SessionHandlers)
