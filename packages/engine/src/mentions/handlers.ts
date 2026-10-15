/**
 * Handlers for the @ and # suggestions (`contract/src/routes/mentions.ts`).
 * Both follow the open workspace like New chat's pickers
 * (`newchat/handlers.ts`) and never call Slack. They re-run when people or
 * conversations change; who posted lately is read again on the next query.
 */
import { MentionsRoutes } from '@juno/contract'
import type { InvalidationKeys } from '@juno/store'
import { Effect } from 'effect'
import { serveWorkspaceValue } from '../protocol/live'
import { Workspace } from '../workspace'
import { queryChannels, queryPeople } from './query'

const KEYS: InvalidationKeys = ['users', 'conversations', 'team']

export const MentionsHandlers = MentionsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const live = <A, E, R>(name: string, query: Effect.Effect<A, E, R>) => serveWorkspaceValue(workspace.changes, name, KEYS, query)
    return {
      'mentions.people': ({ channel, threadTs, query }) => live('mentions.people', queryPeople(channel, threadTs, query)),
      'mentions.channels': ({ query }) => live('mentions.channels', queryChannels(query)),
    }
  }),
)
