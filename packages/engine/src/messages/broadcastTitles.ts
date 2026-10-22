import type { MessageView } from '@juno/contract'
import type { UsergroupName } from '@juno/richtext'
import { resolveTitle } from '@juno/domain'
import type { SqlClient } from '@juno/store'
import { Effect } from 'effect'
import { channelInfoOf, parseColumns, topicFrom, TOPIC_COLUMNS, TOPIC_FROM, userIdsOf, userName, type JoinedRow, type UserRow } from '../topicRows'

export const broadcastTitlesStatement = (ids: ReadonlyArray<string>) => ({
  sql: `${TOPIC_COLUMNS}, NULL AS channel_activity_ts ${TOPIC_FROM} WHERE i.topic_id IN (${ids.map(() => '?').join(', ')})`,
  params: ids,
})

/** Main's broadcast sources use the same indexed titles as the sidebar and header. */
export const broadcastTitles = (sql: SqlClient.SqlClient, ids: ReadonlyArray<string>, selfId: string | undefined) => Effect.gen(function* () {
  const titles = new Map<string, NonNullable<MessageView['broadcastFrom']>>()
  if (ids.length === 0) return titles
  const statement = broadcastTitlesStatement(ids)
  const rows = yield* sql.unsafe<JoinedRow>(statement.sql, statement.params)
  const parsed = rows.map((row) => ({ row, columns: parseColumns(row) }))
  const wanted = new Set<string>()
  for (const { row, columns } of parsed) userIdsOf(row, columns, wanted)
  const users = new Map<string, UserRow>()
  if (wanted.size > 0) for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in([...wanted])}`) users.set(user.id, user)
  const groups = new Map<string, UsergroupName>()
  if (parsed.some(({ columns }) => columns.preview.rootText?.includes('<!subteam^'))) {
    for (const group of yield* sql<{ id: string; handle: string }>`SELECT id, handle FROM usergroups`) groups.set(group.id, { handle: group.handle })
  }
  const nameOf = (id: string) => userName(id, users.get(id))
  for (const { row, columns } of parsed) {
    const topic = topicFrom(row, columns, channelInfoOf(row, columns, selfId, nameOf))
    const title = resolveTitle(topic, { user: nameOf, usergroup: (id) => groups.get(id) })
    titles.set(row.root_ts!, { id: row.topic_id, title: title.text, sensitive: title.sensitive })
  }
  return titles
})
