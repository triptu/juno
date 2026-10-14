/**
 * The durable core as an Effect service, for the agent's layer (start.ts).
 * The layer opens the core (lock, store, recovery, journal) and closes it,
 * in the G9 order, when the layer's scope closes. The service is either the
 * running core or the "Juno needs to update its records" stop.
 */
import { Context, Effect, Layer, Schema } from 'effect'
import { openCore, type Core, type CoreOptions, type UpdateNeeded } from './core'
import { OwnerLockHeld } from './lock'

/** The core could not open. `ownerLockHeld`: another Juno process owns the agent directory. */
export class CoreOpenFailed extends Schema.TaggedError<CoreOpenFailed>()('CoreOpenFailed', {
  message: Schema.String,
  ownerLockHeld: Schema.Boolean,
}) {}

export class DurableCore extends Context.Service<DurableCore, Core | UpdateNeeded>()('juno/agent/DurableCore') {
  static layer(options: CoreOptions): Layer.Layer<DurableCore, CoreOpenFailed> {
    return Layer.effect(
      DurableCore,
      Effect.acquireRelease(
        Effect.tryPromise({
          try: () => openCore(options),
          catch: (cause) => new CoreOpenFailed({ message: String((cause as Error)?.message ?? cause), ownerLockHeld: cause instanceof OwnerLockHeld }),
        }),
        (core) => Effect.promise(() => core.close()),
      ),
    )
  }
}
