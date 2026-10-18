/** The ignore list on Settings › Ignored (inventory 14): ignored channels, newest first, with how many messages arrived since. */
import { Effect } from 'effect'
import { IGNORABLE_LIMIT, IGNORED_HIDDEN_CAP, type IgnorableChannel, type IgnoredChannel } from '@juno/contract'
import { StoreReader, type SqlError } from '@juno/store'

export const listIgnoredChannels: Effect.Effect<ReadonlyArray<IgnoredChannel>, SqlError, StoreReader> = Effect.gen(function* () {
  const sql = yield* StoreReader
  // `ignored_at` is milliseconds; Slack's ts is seconds. The count reads at most the cap per channel through `messages_main`.
  const rows = yield* sql<{ id: string; name: string | null; kind: 'public' | 'private'; hidden: number }>`
    SELECT c.id, c.name, c.kind, (SELECT count(*) FROM (SELECT 1 FROM messages m WHERE m.channel = c.id AND m.deleted = 0
      AND CAST(m.ts AS REAL) * 1000 > CAST(ig.ignored_at AS REAL) LIMIT ${IGNORED_HIDDEN_CAP})) AS hidden
    FROM ignored_channels ig JOIN conversations c ON c.id = ig.channel
    WHERE c.kind IN ('public', 'private')
    ORDER BY CAST(ig.ignored_at AS REAL) DESC, c.id`
  return rows.map((row) => ({ id: row.id, name: row.name ?? row.id, kind: row.kind, hidden: Number(row.hidden) }))
})

/** The channels the add row offers (`channels.ignorable`): yours, not archived and not ignored, by name. */
export const ignorableStatement = `SELECT c.id, c.name, c.kind FROM conversations c LEFT JOIN ignored_channels g ON g.channel = c.id
  WHERE c.kind IN ('public', 'private') AND c.is_member = 1 AND c.is_archived = 0 AND c.name IS NOT NULL AND g.channel IS NULL
  ORDER BY c.name COLLATE NOCASE, c.id LIMIT ${IGNORABLE_LIMIT}`

export const listIgnorableChannels: Effect.Effect<ReadonlyArray<IgnorableChannel>, SqlError, StoreReader> = Effect.gen(function* () {
  const sql = yield* StoreReader
  return yield* sql.unsafe<IgnorableChannel>(ignorableStatement)
})
