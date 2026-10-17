/**
 * Handlers for the @ and # suggestions (`contract/src/routes/mentions.ts`).
 * Each follows the open workspace like Home's destination pickers
 * (`newchat/handlers.ts`) and never call Slack. They re-run when people or
 * conversations change; who posted lately is read again on the next query.
 */
import { MentionsRoutes } from '@juno/contract'
import { StoreReader, type InvalidationKeys } from '@juno/store'
import { Effect } from 'effect'
import { serveWorkspaceValue } from '../protocol/live'
import { Workspace } from '../workspace'
import { queryChannels, queryGroups, queryPeople } from './query'

const KEYS: InvalidationKeys = ['users', 'conversations', 'team']

export const MentionsHandlers = MentionsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const live = <A, E, R>(name: string, query: Effect.Effect<A, E, R>) => serveWorkspaceValue(workspace.changes, name, KEYS, query)
    return {
      'mentions.emoji': () => serveWorkspaceValue(workspace.changes, 'mentions.emoji', ['emoji', 'team'], Effect.gen(function* () {
        const sql = yield* StoreReader
        return yield* sql<{ name: string; url: string | null; alias_for: string | null }>`SELECT name, url, alias_for FROM emoji ORDER BY name`
      })),
      'mentions.people': ({ channel, threadTs, query }) => live('mentions.people', queryPeople(channel, threadTs, query)),
      'mentions.groups': ({ query }) => serveWorkspaceValue(workspace.changes, 'mentions.groups', ['usergroups', 'team'], queryGroups(query)),
      'mentions.channels': ({ query }) => live('mentions.channels', queryChannels(query)),
    }
  }),
)
