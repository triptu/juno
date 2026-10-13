import { SearchRoutes } from '@juno/contract'
import { liveQuery } from '@juno/store'
import { Effect, Stream } from 'effect'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace } from '../workspace'
import { querySearch } from './query'

export const SearchHandlers = SearchRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    return {
      'search.query': ({ query, limit }) => {
        const runs = workspace.changes.pipe(
          Stream.switchMap((open) => {
            if (open === undefined) return Stream.empty
            return liveQuery(
              ['messages', 'topics', 'topic_overlay', 'conversations', 'users', 'ignored_channels'],
              timed(querySearch(query, limit)),
            ).pipe(Stream.provide(open.context))
          }),
        )
        return serveLiveValue(runs).pipe(retryFirstRun('search.query'), Stream.orDie)
      },
    }
  }),
)
