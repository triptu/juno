import { PrefsRoutes, NotSignedIn, MIRROR_READS_PREF } from '@juno/contract'
import { keys, liveQuery, prefs, transaction } from '@juno/store'
import { Effect, Schema, Stream } from 'effect'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { decisionProviderAvailable } from '../ai'
import { AiCredentials } from '../aiCredentials'
import { EngineConfig } from '../config'
import { MarkWorker } from '../markWorker'
import { Workspace } from '../workspace'

export const PrefsHandlers = PrefsRoutes.toLayer(
  Effect.gen(function* () {
    const config = yield* EngineConfig
    const credentials = yield* AiCredentials
    const workspace = yield* Workspace
    const worker = yield* MarkWorker
    return {
      // Answers again whenever main hands over a new key or takes it away.
      'ai.available': () => serveLiveValue(credentials.revisions.pipe(
        Stream.mapEffect(() => Effect.result(timed(decisionProviderAvailable.pipe(Effect.provideService(EngineConfig, config), Effect.provideService(AiCredentials, credentials))))),
      )),
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
        if (key === MIRROR_READS_PREF) yield* worker.wake
      }),
    }
  }),
)
