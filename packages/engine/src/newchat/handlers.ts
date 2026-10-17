/**
 * Handlers for New chat (`contract/src/routes/newChat.ts`). The two picker
 * queries follow the open workspace like search (`search/handlers.ts`) and
 * never call Slack. Sending is the send feature's (`send/`).
 */
import { NewChatRoutes } from '@juno/contract'
import type { InvalidationKeys } from '@juno/store'
import { Effect } from 'effect'
import { serveWorkspaceValue } from '../protocol/live'
import { Workspace } from '../workspace'
import { queryConversations, queryFrequent, queryPaletteConversations } from './query'

const KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'conversations', 'users', 'ignored_channels', 'team', 'messages']
const RANKED_KEYS: InvalidationKeys = ['conversations', 'users', 'ignored_channels', 'team', 'topic_visits']

export const NewChatHandlers = NewChatRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const live = <A, E, R>(name: string, query: Effect.Effect<A, E, R>) => serveWorkspaceValue(workspace.changes, name, KEYS, query)
    return {
      'newChat.frequent': () => live('newChat.frequent', queryFrequent()),
      'newChat.conversations': ({ query }) => live('newChat.conversations', queryConversations(query)),
      // Own sends re-rank it on the next open; a message event never re-runs it.
      'newChat.ranked': ({ query }) => serveWorkspaceValue(workspace.changes, 'newChat.ranked', RANKED_KEYS, queryPaletteConversations(query)),
    }
  }),
)
