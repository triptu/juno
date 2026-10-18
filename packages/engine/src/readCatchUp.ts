/** One durable catch-up per workspace. Queue insertion and completion commit together. */
import { Clock, Effect } from 'effect'
import { millisToTs } from '@juno/domain'
import { prefs, StoreReader, StoreWriter, type SqlClient } from '@juno/store'
import { readState, storedMe, writeLocalMark } from '@juno/sync'
import type { EngineConfig } from '@juno/contract'
import { mirrorSetting } from './readSetting'
import { EngineTiming } from './config'

const DONE = 'reads.mirrorCatchUp'
const MIGRATED = 'reads.mirrorDefaultApplied'

// Unknown Slack pointers and unfollowed threads cannot be safely mirrored.
const candidates = (sql: SqlClient.SqlClient) => sql<{ topic_id: string }>`
  WITH eligible(topic_id) AS (
    SELECT 'm:' || id FROM conversations
    UNION ALL
    SELECT 't:' || channel || ':' || thread_ts FROM thread_subs WHERE subscribed = 1
  )
  SELECT r.topic_id FROM eligible e JOIN topic_reads r ON r.topic_id = e.topic_id
  WHERE r.last_read_ts > r.slack_read_ts AND r.marked_unread = 0
    AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.kind = 'mark' AND o.target_key = r.topic_id)`

export const readCatchUpStatus = Effect.gen(function* () {
  const sql = yield* StoreReader
  const done = (yield* prefs.get(DONE)) === true
  const pending = yield* sql<{ n: number }>`SELECT count(*) AS n FROM outbox
    WHERE kind = 'mark' AND json_extract(payload_json, '$.catchUp') = 1`
  return { available: done ? 0 : (yield* candidates(sql)).length, pending: pending[0]?.n ?? 0 }
})

/** Must run in the caller's writer transaction; automatic migration only applies to an unset preference. */
export const queueReadCatchUp = (config: EngineConfig, automatic = false) => Effect.gen(function* () {
  const sql = yield* StoreWriter
  const setting = yield* mirrorSetting(config)
  if (!setting.on || (automatic && setting.explicit)) return
  if (automatic) {
    if ((yield* storedMe) === undefined) return
    const migrated = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = ${MIGRATED}`
    if (migrated[0]?.value_json === 'true') return
    yield* prefs.set(MIGRATED, true)
  }
  const done = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = ${DONE}`
  if (done[0]?.value_json === 'true') return
  const now = yield* Clock.currentTimeMillis
  const topics = yield* candidates(sql)
  if (topics.length === 0) return
  for (const { topic_id: id } of topics) {
    const state = yield* readState(id)
    if (state.lastReadTs === undefined) continue
    yield* writeLocalMark(id, {
      ...state, commanded: true, observedAt: millisToTs(now), pendingLocalWrite: true,
      intent: { lastReadTs: state.lastReadTs, unread: false },
    }, undefined, now, (yield* EngineTiming).markDelayMillis, true)
  }
  yield* prefs.set(DONE, true)
})
