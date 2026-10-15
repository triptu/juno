import { Effect } from 'effect'
import { StoreReader } from '@juno/store'
import type { WindowTarget } from './window'

/** Whether the stored window is covered by history, rather than isolated socket or search results. */
export const windowCovered = (target: WindowTarget, first: string | undefined) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    if (first === undefined) return false
    if (target.kind === 'main') {
      // Socket messages can extend the tail past the last history fetch. The
      // oldest shown row must come from a covered range, not an isolated hit.
      const ranges = yield* sql<{ covered: number }>`SELECT 1 AS covered FROM synced_ranges
        WHERE channel = ${target.channel} AND from_ts <= ${first} AND to_ts >= ${first} LIMIT 1`
      return ranges.length > 0
    }
    const roots = yield* sql<{ reply_count: number; user_id: string | null; text: string; blocks_json: string | null }>`
      SELECT reply_count, user_id, text, blocks_json FROM messages WHERE channel = ${target.channel} AND ts = ${target.threadTs}`
    const root = roots[0]
    if (root === undefined || (root.user_id === null && root.text === '' && root.blocks_json === null)) return false
    const counts = yield* sql<{ n: number }>`SELECT count(*) AS n FROM messages
      WHERE channel = ${target.channel} AND thread_ts = ${target.threadTs} AND ts <> ${target.threadTs} AND deleted = 0`
    if ((counts[0]?.n ?? 0) >= root.reply_count) return true
    const cursors = yield* sql<{ complete_from: string | null }>`SELECT complete_from FROM thread_cursors
      WHERE channel = ${target.channel} AND thread_ts = ${target.threadTs}`
    const from = cursors[0]?.complete_from
    return from != null && from <= first
  })
