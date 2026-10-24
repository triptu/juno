import { resolveSearch } from '../searchResolve'
import { SyncLink } from '../syncLink'
import { searchSessions } from './session'
import { NotSignedIn, SearchRoutes } from '@juno/contract'
import { AiProvider } from '@juno/ai'
import { liveQuery } from '@juno/store'
import { Effect, Stream } from 'effect'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { SessionClient } from '../sessionClient'
import { Workspace } from '../workspace'
import { queryCommand } from './command'
import { querySearch } from '../searchQuery'
import { searchSlack } from './slack'

export const SearchHandlers = SearchRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const session = yield* SessionClient
    const provider = yield* AiProvider
    const sessions = searchSessions(session, yield* SyncLink)
    const store = Effect.gen(function* () {
      const open = yield* workspace.current
      if (open === undefined) return yield* new NotSignedIn()
      return open.context
    })
    return {
      'search.session': (input) => serveLiveValue(workspace.changes.pipe(Stream.switchMap((open) => open === undefined ? Stream.empty : sessions.stream(open, input)))).pipe(Stream.orDie),
      'search.matches': (input) => serveLiveValue(workspace.changes.pipe(Stream.switchMap((open) => open === undefined ? Stream.empty : liveQuery(['messages', 'topics', 'reactions', 'users', 'conversations', 'ignored_channels', 'sidebar_view_channels'], timed(sessions.matches(input))).pipe(Stream.provide(open.context))))).pipe(Stream.orDie),
      'search.calendar': () => Effect.gen(function* () {
        const context = yield* store
        return yield* resolveSearch('').pipe(Effect.map((search) => search.timeZone), Effect.provide(context), Effect.orDie)
      }),
      'search.more': ({ sessionId, generation, offset }) => sessions.more(sessionId, generation, offset),
      'search.query': ({ query, limit, places }) => {
        const runs = workspace.changes.pipe(
          Stream.switchMap((open) => {
            if (open === undefined) return Stream.empty
            return liveQuery(
              ['messages', 'topics', 'topic_overlay', 'conversations', 'users', 'ignored_channels', 'sidebar_view_channels', 'reactions'],
              timed(querySearch(query, limit, places)),
            ).pipe(Stream.provide(open.context))
          }),
        )
        return serveLiveValue(runs).pipe(retryFirstRun('search.query'), Stream.orDie)
      },
      'search.slack': ({ query }) =>
        Effect.gen(function* () {
          const api = yield* session.api
          const context = yield* store
          return yield* searchSlack(api, query).pipe(Effect.provide(context), Effect.orDie)
        }),
      'search.command': ({ text }) =>
        Effect.gen(function* () {
          const context = yield* store
          return yield* queryCommand(text).pipe(Effect.provideService(AiProvider, provider), Effect.provide(context), Effect.orDie)
        }),
    }
  }),
)
