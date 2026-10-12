/**
 * The app layer. Feature tracks add their handler layer to `Handlers` and
 * their services to `Services`; this file is otherwise edited only by the
 * milestone's integration task.
 */
import { Layer } from 'effect'
import { SessionHandlers } from './session/handlers'
import { Session } from './session/Session'
import { StatusHandlers } from './status/handlers'
import { Status } from './status/Status'

/** Everything the route handlers need. Requires the host seams (`HostLink`, `HttpTransport`) and `EngineConfig`. */
export const Services = Session.layer.pipe(Layer.provideMerge(Status.layer))

/** One `toLayer` per feature, merged. Requires `Services`. */
export const Handlers = Layer.mergeAll(StatusHandlers, SessionHandlers)
