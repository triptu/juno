/** Resolve a thread started from Home without changing the subscription or its view identity. */
import { Effect } from 'effect'
import { StoreReader } from '@juno/store'

export const pendingThread = (id: string) => {
  const match = /^p:([^:]+):([^:]+)$/.exec(id)
  return match === null ? undefined : { channel: match[1]!, clientMsgId: match[2]! }
}

export const resolveStartedThread = (id: string) => Effect.gen(function* () {
  const pending = pendingThread(id)
  if (pending === undefined) return id
  const sql = yield* StoreReader
  const row = (yield* sql<{ root_ts: string | null }>`SELECT root_ts FROM started_threads WHERE topic_id = ${id}`)[0]
  return row?.root_ts == null ? id : `t:${pending.channel}:${row.root_ts}`
})

