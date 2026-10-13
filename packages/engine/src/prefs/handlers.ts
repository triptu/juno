import { PrefsRoutes, NotSignedIn } from '@juno/contract'
import { keys, liveQuery, prefs, transaction } from '@juno/store'
import { Effect, Schema, Stream } from 'effect'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace } from '../workspace'

export const PrefsHandlers = PrefsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    return {
      'prefs.get': ({ key }) => {
        const runs = workspace.changes.pipe(
          Stream.switchMap((open) => {
            if (open === undefined) return Stream.empty
            const read = prefs.get(key).pipe(Effect.map((value) => Schema.decodeUnknownSync(Schema.Json)(value ?? null)))
            return liveQuery(keys.prefs, timed(read)).pipe(Stream.provide(open.context))
          }),
        )
        return serveLiveValue(runs).pipe(retryFirstRun('prefs.get'), Stream.orDie)
      },
      'prefs.set': ({ key, value }) => Effect.gen(function* () {
        const open = yield* workspace.current
        if (open === undefined) return yield* new NotSignedIn()
        yield* transaction(prefs.set(key, value)).pipe(Effect.provide(open.context), Effect.orDie)
      }),
    }
  }),
)
