/**
 * A stored conversation as a New chat or ⌘K row (`PickConversation`), and
 * a person with no DM yet.
 */
import type { PickConversation } from '@juno/contract'
import { channelLabelBare, contextTint, defaultChannelStyle, mainTopicId, type ChannelId, type ConversationKind } from '@juno/domain'
import { parseIds, personFrom, userName, type UserRow } from '../topicRows'

/** A conversation row with whether Juno holds any of its messages. */
export interface ConversationRow {
  readonly id: string
  readonly kind: ConversationKind
  readonly name: string | null
  readonly user_id: string | null
  readonly member_ids_json: string | null
  readonly has_topics: 0 | 1
}

export const CONVERSATION_COLUMNS = `c.id, c.kind, c.name, c.user_id, c.member_ids_json,
  EXISTS (SELECT 1 FROM topic_index t WHERE t.channel = c.id) AS has_topics`

/** The people a set of conversation rows names: DM partners and group DM members. */
export function peopleOf(rows: ReadonlyArray<ConversationRow>): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.user_id !== null) ids.add(row.user_id)
    if (row.kind === 'mpim') for (const id of parseIds(row.member_ids_json)) ids.add(id)
  }
  return ids
}

export function pickOf(row: ConversationRow, users: ReadonlyMap<string, UserRow>, selfId: string | undefined): PickConversation {
  const base = { key: row.id, kind: row.kind, tint: contextTint(row.kind), channelId: row.id, mainId: mainTopicId(row.id as ChannelId), empty: row.has_topics === 0 }
  switch (row.kind) {
    case 'im': {
      const userId = row.user_id ?? row.id
      const person = personFrom(userId, users.get(userId))
      return { ...base, name: person.name, person }
    }
    case 'mpim': {
      const memberNames = parseIds(row.member_ids_json)
        .filter((id) => id !== selfId)
        .map((id) => userName(id, users.get(id)))
      return { ...base, name: channelLabelBare({ kind: 'mpim', name: row.name ?? row.id, memberNames }) }
    }
    default: {
      const style = defaultChannelStyle(row.id, row.kind)
      return { ...base, name: row.name ?? row.id, icon: style.icon, color: style.color }
    }
  }
}

/** A person with no DM yet: sending opens one. */
export const newPerson = (user: UserRow): PickConversation => ({
  key: `u:${user.id}`,
  name: userName(user.id, user),
  kind: 'im',
  tint: 'dm',
  person: personFrom(user.id, user),
  empty: true,
})
