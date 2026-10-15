/**
 * Handlers for New chat (`contract/src/routes/newChat.ts`). The two picker
 * queries follow the open workspace like search (`search/handlers.ts`) and
 * never call Slack. Sending is the send feature's (`send/`).
 */
import { NewChatRoutes } from '@juno/contract'
import { liveQuery, type InvalidationKeys } from '@juno/store'
import { Effect, Stream } from 'effect'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace } from '../workspace'
import { queryConversations, queryThreads } from './query'

const KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'conversations', 'users', 'ignored_channels', 'team']

export const NewChatHandlers = NewChatRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const live = <A, E, R>(name: string, query: Effect.Effect<A, E, R>) =>
      serveLiveValue(
        workspace.changes.pipe(
          Stream.switchMap((open) => (open === undefined ? Stream.empty : liveQuery(KEYS, timed(query)).pipe(Stream.provide(open.context)))),
        ),
      ).pipe(retryFirstRun(name), Stream.orDie)
    return {
      'newChat.conversations': ({ query }) => live('newChat.conversations', queryConversations(query)),
      'newChat.threads': ({ channel, query }) => live('newChat.threads', queryThreads(channel, query)),
    }
  }),
)
