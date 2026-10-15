/**
 * The app layer. Feature tracks add their handler layer to `Handlers` and
 * their services to `Services`; this file is otherwise edited only by the
 * milestone's integration task.
 */
import { Effect, Layer, Ref, Stream } from 'effect'
import type { EnginePhase, SessionStatus } from '@juno/contract'
import type { SyncPhase } from '@juno/sync'
import { NotificationControl } from './notificationRuntime'
import { JunoHostLive, PhaseSource } from './agent-host/host'
import { AiProviderLive } from './ai'
import { ArtHandlers } from './art/handlers'
import { ArtJob } from './art/job'
import { HomeHandlers } from './home/handlers'
import { HomeJob } from './home/job'
import { SearchHandlers } from './search/handlers'
import { PrefsHandlers } from './prefs/handlers'
import { MessagesHandlers } from './messages/handlers'
import { NewChatHandlers } from './newchat/handlers'
import { NotificationsHandlers } from './notifications/handlers'
import { SendHandlers } from './send/handlers'
import { FilesHandlers } from './files/handlers'
import { UploadProgress } from './uploadProgress'
import { Staging } from './staging'
import { ActionWorker } from './send/actionWorker'
import { PostWorker } from './send/worker'
import { ReadsHandlers } from './reads/handlers'
import { MarkWorker } from './markWorker'
import { Outbox } from './outbox'
import { SessionClientLive } from './session/client'
import { SessionHandlers } from './session/handlers'
import { Session } from './session/Session'
import { StatusHandlers } from './status/handlers'
import { Status } from './status/Status'
import { SyncRunner } from './session/SyncRunner'
import { SyncLink } from './syncLink'
import { AllTopicsHandlers, TopicsHandlers } from './topics/handlers'
import { ViewsHandlers } from './sidebarViews/handlers'
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
    yield* Effect.forkScoped(Stream.runForEach(sync.syncing, status.setSyncing))
  }),
)

/** Everything the route handlers need. Requires the host seams (`HostLink`, `HttpTransport`) and `EngineConfig`. */
export const Services = Layer.mergeAll(EnginePhases, ArtJob, HomeJob).pipe(
  Layer.provideMerge(MarkWorker.layer),
  Layer.provideMerge(PostWorker.layer),
  Layer.provideMerge(Staging.layer),
  Layer.provideMerge(UploadProgress.layer),
  Layer.provideMerge(ActionWorker.layer),
  Layer.provideMerge(SyncRunner.layer),
  Layer.provideMerge(AiProviderLive),
  Layer.provideMerge(NotificationControl.layer),
  Layer.provideMerge(SyncLink.layer),
  Layer.provideMerge(Outbox.layer),
  Layer.provideMerge(SessionClientLive),
  Layer.provideMerge(Session.layer),
  Layer.provideMerge(Workspace.layer),
  Layer.provideMerge(Status.layer),
)

/** One `toLayer` per feature, merged. Requires `Services`. */
export const Handlers = Layer.mergeAll(StatusHandlers, SessionHandlers, TopicsHandlers, SearchHandlers, PrefsHandlers, MessagesHandlers, ReadsHandlers, ArtHandlers, NewChatHandlers, SendHandlers, HomeHandlers, AllTopicsHandlers, NotificationsHandlers, ViewsHandlers, FilesHandlers)

/** The engine's side of the AgentHost port (ADR 0012): `JunoHost` over `Services`, with the engine phase from the status feature. */
export const AgentHost = JunoHostLive.pipe(Layer.provide(Layer.effect(PhaseSource, Status.use((status) => Effect.succeed(status.phases)))))
