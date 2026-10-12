import { Effect, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { AppInfo } from '@juno/contract'

/**
 * Asks main for the app info once and validates the answer against the
 * contract. Components read it as an AsyncResult through useAtomValue.
 */
export const appInfoAtom = Atom.make(
  Effect.tryPromise({
    try: () => window.juno.app.getInfo(),
    catch: (cause) => new Error('app.getInfo failed', { cause }),
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(AppInfo))),
)
