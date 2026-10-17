/**
 * Handlers for the views routes (`views.ts`). `views.list` follows the open
 * workspace like the other live values: nothing while none is open, and it
 * re-runs when a view, a conversation or a person changes.
 */
import { Effect, Stream } from 'effect'
import { ViewsRoutes } from '@juno/contract'
import { keys, liveQuery, type InvalidationKeys } from '@juno/store'
import { EngineConfig } from '../config'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace } from '../workspace'
import { deleteView, listViews, reorderViews, restoreView, saveView, setViewChannel, sortChannel } from '../viewCommands'

const LIST_KEYS: InvalidationKeys = [...keys.sidebarViews, ...keys.automatedChannels, 'conversations', 'users']

export const ViewsHandlers = ViewsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev
    const provide = <A, E>(effect: Effect.Effect<A, E, Workspace>) => Effect.provideService(effect, Workspace, workspace)
    return {
      'views.list': () => {
        const runs = workspace.changes.pipe(
          Stream.switchMap((open) => (open === undefined ? Stream.empty : liveQuery(LIST_KEYS, timed(listViews)).pipe(Stream.provide(open.context)))),
        )
        return serveLiveValue(runs, { measure }).pipe(retryFirstRun('views.list'), Stream.orDie)
      },
      'views.save': (draft) => provide(saveView(draft)),
      'views.delete': ({ id }) => provide(deleteView(id)),
      'views.restore': ({ view }) => provide(restoreView(view)),
      'views.addChannel': ({ id, channel }) => provide(setViewChannel(id, channel, true)),
      'views.removeChannel': ({ id, channel }) => provide(setViewChannel(id, channel, false)),
      'views.reorder': ({ ids }) => provide(reorderViews(ids)),
      'views.sortChannel': ({ channel, to, restore }) => provide(sortChannel(channel, to, restore)),
    }
  }),
)
