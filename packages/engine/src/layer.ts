/**
 * The app layer. Feature tracks add their handler layer to `Handlers` and
 * their services to `Services`; this file is otherwise edited only by the
 * milestone's integration task.
 */
import { Effect, Layer, Ref, Stream } from 'effect'
import type { EnginePhase, SessionStatus } from '@juno/contract'
import type { SyncPhase } from '@juno/sync'
import { SessionHandlers } from './session/handlers'
import { Session } from './session/Session'
import { StatusHandlers } from './status/handlers'
import { Status } from './status/Status'
import { SyncRunner } from './session/SyncRunner'
import { TopicsHandlers } from './topics/handlers'
import { Workspace } from './workspace'

/**
 * The engine phase (architecture 2.5 and 11) from the session and the sync:
 * no session is `first-run`, a rejected one `session-expired`; a ready one
 * reports the sync's phase, or `offline` until the sync has started.
 */
const phaseOf = (session: SessionStatus, sync: SyncPhase | undefined): EnginePhase => {
  if (session._tag === 'authRequired') return { _tag: 'session-expired' }
  if (session._tag !== 'ready') return { _tag: 'first-run' }
  return sync ?? { _tag: 'offline' }
}

/** Keeps `engine.status` in step with the session and the sync for the life of the app. */
const EnginePhases = Layer.effectDiscard(
  Effect.gen(function* () {
    const session = yield* Session
    const sync = yield* SyncRunner
    const status = yield* Status
    const latest = yield* Ref.make<{ session: SessionStatus; sync: SyncPhase | undefined }>({ session: yield* session.status, sync: yield* sync.current })
    const update = (change: Partial<{ session: SessionStatus; sync: SyncPhase | undefined }>) =>
      Effect.gen(function* () {
        const next = yield* Ref.updateAndGet(latest, (current) => ({ ...current, ...change }))
        yield* status.setPhase(phaseOf(next.session, next.sync))
      })
    yield* Effect.forkScoped(Stream.runForEach(session.statuses, (value) => update({ session: value })))
    yield* Effect.forkScoped(Stream.runForEach(sync.phases, (value) => update({ sync: value })))
  }),
)

/** Everything the route handlers need. Requires the host seams (`HostLink`, `HttpTransport`) and `EngineConfig`. */
export const Services = EnginePhases.pipe(
  Layer.provideMerge(SyncRunner.layer),
  Layer.provideMerge(Session.layer),
  Layer.provideMerge(Workspace.layer),
  Layer.provideMerge(Status.layer),
)

/** One `toLayer` per feature, merged. Requires `Services`. */
export const Handlers = Layer.mergeAll(StatusHandlers, SessionHandlers, TopicsHandlers)
