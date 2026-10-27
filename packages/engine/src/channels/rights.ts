/**
 * `channels.rights`: what the user may change in a channel, from the store
 * alone (`channelEditRights` in `@juno/domain`), so a menu opens at once.
 */
import type { ChannelRights } from '@juno/contract'
import { channelEditRights, type ConversationKind, type WorkspaceRole } from '@juno/domain'
import { StoreReader, type SqlError } from '@juno/store'
import { SELF_ROLE_KEY } from '@juno/sync'
import { Effect } from 'effect'

const ROLES: ReadonlySet<string> = new Set<WorkspaceRole>(['owner', 'admin', 'member', 'guest'])

export const channelRights = (channel: string): Effect.Effect<ChannelRights, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const [row] = yield* sql<{ kind: ConversationKind; is_member: 0 | 1; is_archived: 0 | 1; is_general: 0 | 1; is_ext_shared: 0 | 1; creator: string | null; self: string | null }>`
      SELECT c.kind, c.is_member, c.is_archived, c.is_general, c.is_ext_shared, c.creator, (SELECT self_user_id FROM team LIMIT 1) AS self
      FROM conversations c WHERE c.id = ${channel}`
    if (row === undefined) return { rename: false, members: false }
    const [state] = yield* sql<{ value_json: string }>`SELECT value_json FROM sync_state WHERE key = ${SELF_ROLE_KEY}`
    const role = state === undefined ? undefined : (JSON.parse(state.value_json) as unknown)
    return channelEditRights({
      kind: row.kind,
      archived: row.is_archived === 1,
      member: row.is_member === 1,
      general: row.is_general === 1,
      externallyShared: row.is_ext_shared === 1,
      createdByUser: row.creator !== null && row.creator === row.self,
      role: typeof role === 'string' && ROLES.has(role) ? (role as WorkspaceRole) : undefined,
    })
  })
