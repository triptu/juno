/**
 * Handlers for the @ and # suggestions (`contract/src/routes/mentions.ts`).
 * Both follow the open workspace like New chat's pickers
 * (`newchat/handlers.ts`) and never call Slack. They re-run when people or
 * conversations change; who posted lately is read again on the next query.
 */
import { MentionsRoutes } from '@juno/contract'
import { liveQuery, type InvalidationKeys } from '@juno/store'
import { Effect, Stream } from 'effect'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace } from '../workspace'
import { queryChannels, queryPeople } from './query'

const KEYS: InvalidationKeys = ['users', 'conversations', 'team']

export const MentionsHandlers = MentionsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const live = <A, E, R>(name: string, query: Effect.Effect<A, E, R>) =>
      serveLiveValue(
        workspace.changes.pipe(
          Stream.switchMap((open) => (open === undefined ? Stream.empty : liveQuery(KEYS, timed(query)).pipe(Stream.provide(open.context)))),
        ),
      ).pipe(retryFirstRun(name), Stream.orDie)
    return {
      'mentions.people': ({ channel, threadTs, query }) => live('mentions.people', queryPeople(channel, threadTs, query)),
      'mentions.channels': ({ query }) => live('mentions.channels', queryChannels(query)),
    }
  }),
)
