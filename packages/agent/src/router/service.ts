/**
 * The turn engine as an Effect service, beside WP8's `DurableCore`. The
 * layer opens the engine and closes it, in the G9 order, when its scope
 * closes. The service is the running engine or the "Juno needs to update its
 * records" stop.
 */
import { Context, Effect, Layer, type Scope } from 'effect'
import type { UpdateNeeded } from '../runtime/core'
import { CoreOpenFailed } from '../runtime/service'
import { OwnerLockHeld } from '../runtime/lock'
import { openTurns, type Turns, type TurnsOptions } from './open'

export class TurnEngine extends Context.Service<TurnEngine, Turns | UpdateNeeded>()('juno/agent/TurnEngine') {
  static layer(options: TurnsOptions): Layer.Layer<TurnEngine, CoreOpenFailed> {
    return Layer.effect(TurnEngine, open(options))
  }
}

/** Opens the engine in the current scope; it closes with the scope. */
export function open(options: TurnsOptions): Effect.Effect<Turns | UpdateNeeded, CoreOpenFailed, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: () => openTurns(options),
      catch: (cause) => new CoreOpenFailed({ message: String((cause as Error)?.message ?? cause), ownerLockHeld: cause instanceof OwnerLockHeld }),
    }),
    (engine) => Effect.promise(() => engine.close()),
  )
}
