/**
 * Handlers for the read routes. The commands (`commands.ts`) change Juno's
 * pointer in one transaction and wake `MarkWorker` when a mark waits to be
 * sent. `reads.mirror` follows the open workspace's preference and sends
 * nothing while no workspace is open.
 */
import { Effect, Stream } from 'effect'
import { ReadsRoutes } from '@juno/contract'
import { keys, liveQuery } from '@juno/store'
import { EngineConfig } from '../config'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace } from '../workspace'
import { markRead, markUnread } from '../marks'
import { readMirrorSetting } from '../readSetting'
import { MarkWorker } from '../markWorker'

export const ReadsHandlers = ReadsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const config = yield* EngineConfig
    const worker = yield* MarkWorker
    const provide = <A, E>(effect: Effect.Effect<{ readonly result: A; readonly queued: boolean }, E, Workspace | EngineConfig>) =>
      effect.pipe(
        Effect.provideService(Workspace, workspace),
        Effect.provideService(EngineConfig, config),
        Effect.tap(({ queued }) => (queued ? worker.wake : Effect.void)),
        Effect.map(({ result }) => result),
      )
    return {
      'reads.markRead': ({ id, upTo }) => provide(markRead(id, upTo)),
      'reads.markUnread': ({ id, from }) => provide(markUnread(id, from)),
      'reads.mirror': () => {
        const runs = workspace.changes.pipe(
          Stream.switchMap((open) =>
            open === undefined ? Stream.empty : liveQuery(keys.prefs, timed(readMirrorSetting(config))).pipe(Stream.provide(open.context)),
          ),
        )
        return serveLiveValue(runs, { measure: config.e2e || config.dev }).pipe(retryFirstRun('reads.mirror'), Stream.orDie)
      },
    }
  }),
)
