import { channelLabel } from '@juno/domain'
import { StoreReader } from '@juno/store'
import { Effect } from 'effect'
import { parseIds, userName, type UserRow } from './topicRows'

interface ConversationNaming {
  readonly kind: 'public' | 'private' | 'im' | 'mpim'
  readonly name: string | null
  readonly user_id: string | null
  readonly member_ids_json: string | null
  readonly is_member: number
}

/**
 * A conversation's label as the sidebar shows it ("#eng", "Maya Chen",
 * "Puneet, Sibi, Dhaval"), never Slack's internal group DM name
 * ("mpdm-…"). Undefined when the store does not know the conversation.
 */
export const conversationLabel = (channel: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const row = (yield* sql<ConversationNaming>`SELECT kind, name, user_id, member_ids_json, is_member FROM conversations WHERE id = ${channel}`)[0]
    return row === undefined ? undefined : { label: yield* labelOf(channel, row), member: row.kind === 'public' || row.is_member !== 0 }
  })

/** A conversation's label, or undefined when the store does not know it or you are not in it. */
export const placeLabel = (channel: string) =>
  conversationLabel(channel).pipe(Effect.map((found) => (found?.member === true ? found.label : undefined)))

const labelOf = (channel: string, row: ConversationNaming) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const people = row.kind === 'im' ? (row.user_id === null ? [] : [row.user_id]) : row.kind === 'mpim' ? parseIds(row.member_ids_json) : []
    const self = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id
    const others = people.filter((id) => id !== self)
    const users = others.length === 0 ? [] : yield* sql<UserRow>`SELECT id, name, COALESCE(NULLIF(real_name, ''), NULLIF(display_name, '')) AS display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in(others)}`
    const nameOf = (id: string) => userName(id, users.find((user) => user.id === id))
    if (row.kind === 'im') return others[0] === undefined ? row.name ?? channel : nameOf(others[0])
    return channelLabel({ kind: row.kind, name: row.name ?? channel, memberNames: others.map(nameOf) })
  })
