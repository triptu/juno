import type { CountEntry } from '@juno/slack-schema'
import { StoreWriter } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from '../keys'

import { invalidate, type Writer } from './shared'

export const setChannelReads = (entries: ReadonlyArray<CountEntry>, countsUpdated: number): Writer =>
  Effect.gen(function* () {
    if (entries.length === 0) return
    const sql = yield* StoreWriter
    for (const entry of entries) {
      yield* sql`INSERT INTO channel_reads (channel, slack_last_read, latest, has_unreads, mention_count, counts_updated)
        VALUES (${entry.id}, ${entry.last_read}, ${entry.latest ?? null}, ${entry.has_unreads ? 1 : 0}, ${entry.mention_count ?? 0}, ${String(countsUpdated)})
        ON CONFLICT (channel) DO UPDATE SET slack_last_read = excluded.slack_last_read, latest = CASE WHEN ${entry.latest !== undefined} THEN excluded.latest ELSE channel_reads.latest END,
          has_unreads = CASE WHEN ${entry.has_unreads !== undefined} THEN excluded.has_unreads ELSE channel_reads.has_unreads END,
          mention_count = CASE WHEN ${entry.mention_count !== undefined} THEN excluded.mention_count ELSE channel_reads.mention_count END, counts_updated = excluded.counts_updated
        WHERE channel_reads.slack_last_read IS NOT excluded.slack_last_read
          OR (${entry.latest !== undefined} AND channel_reads.latest IS NOT excluded.latest)
          OR (${entry.has_unreads !== undefined} AND channel_reads.has_unreads IS NOT excluded.has_unreads)
          OR (${entry.mention_count !== undefined} AND channel_reads.mention_count IS NOT excluded.mention_count)`
    }
    yield* invalidate(syncKeys.channelReads)
  })
