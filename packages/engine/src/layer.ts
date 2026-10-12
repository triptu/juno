/**
 * The app layer. Feature tracks add their handler layer to `Handlers` and
 * their services to `Services`; this file is otherwise edited only by the
 * milestone's integration task.
 */
import { StatusHandlers } from './status/handlers'
import { Status } from './status/Status'

/** Everything the route handlers need. */
export const Services = Status.layer

/** One `toLayer` per feature, merged. Requires `Services`. */
export const Handlers = StatusHandlers
