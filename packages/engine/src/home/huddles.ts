import { Effect } from 'effect'
import { StoreReader } from '@juno/store'
import { HOME_SELECT, type HomeRow } from './rows'

interface MissedRow extends HomeRow {
  readonly call_id: string
  readonly started_by: string
  readonly started_at: number
  readonly ended_at: number
}

export const missedHuddleStatement = (now: number) => ({
  sql: `${HOME_SELECT.replace('SELECT i.*', 'SELECT h.call_id, h.started_by, h.started_at, h.ended_at, i.*')}
    JOIN huddle_history h ON i.channel = h.channel AND i.kind = 'main'
    WHERE h.seen = 0 AND h.joined = 0 AND h.history_known = 1 AND h.ended_at > ?
      AND c.is_member = 1 AND c.is_archived = 0
    ORDER BY h.ended_at DESC LIMIT 30`,
  params: [now - 7 * 24 * 60 * 60_000],
})

export const readMissedHuddles = (now: number) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const statement = missedHuddleStatement(now)
  return (yield* sql.unsafe<MissedRow>(statement.sql, statement.params)).map((row) => ({ huddle: row, row }))
})
