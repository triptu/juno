import type { RunningEngine } from '../harness'
import { openDb } from '../scenario'

interface Stored {
  readonly ts: string
  readonly deleted: number
}
interface Store {
  readonly row: string | undefined
  readonly due: boolean
  readonly sentTs: string | null | undefined
  readonly keptCopies: ReadonlyArray<{ readonly ts: string; readonly hidden: number }>
  readonly copyDeletes: ReadonlyArray<string>
  readonly actions: ReadonlyArray<string>
  /** The ts the user's own deletes name. */
  readonly userDeletes: ReadonlyArray<string>
}

/** One replay's current database generation, in autocommit so every read sees new writes. */
export function outboxReader(engine: RunningEngine) {
  const user = openDb(engine, 'user.db')
  const cache = openDb(engine, 'cache.db')
  const pendingQuery = user.prepare('SELECT state, next_at FROM pending_messages WHERE client_msg_id = ?')
  const sentQuery = user.prepare('SELECT ts FROM sent_posts WHERE client_msg_id = ?')
  const copiesQuery = user.prepare('SELECT ts, hidden FROM kept_copies WHERE channel = ? AND client_msg_id = ?')
  const outboxQuery = user.prepare('SELECT kind, depends_on, payload_json FROM outbox WHERE target_key = ? ORDER BY id')
  const messagesQuery = cache.prepare('SELECT ts, deleted FROM messages WHERE channel = ? AND client_msg_id = ?')
  let closed = false
  return {
    close: () => {
      if (closed) return
      closed = true
      user.close()
      cache.close()
    },
    messages: (channel: string, id: string): ReadonlyArray<Stored> => messagesQuery.all(channel, id) as Array<{ ts: string; deleted: number }>,
    store: (channel: string, id: string): Store => {
      const pending = pendingQuery.get(id) as { state: string; next_at: number } | undefined
      const row = pending?.state
      const due = pending === undefined ? false : pending.next_at <= Date.now()
      const sentTs = (sentQuery.get(id) as { ts: string | null } | undefined)?.ts
      const keptCopies = copiesQuery.all(channel, id) as Array<{ ts: string; hidden: number }>
      const outbox = outboxQuery.all(channel) as Array<{ kind: string; depends_on: string | null; payload_json: string }>
      const copyDeletes: Array<string> = []
      const actions: Array<string> = []
      const userDeletes: Array<string> = []
      for (const action of outbox) {
        const payload = JSON.parse(action.payload_json) as { ts: string | null; clientMsgId: string | null }
        if (action.kind === 'delete' && action.depends_on === null && payload.clientMsgId === null && payload.ts !== null) copyDeletes.push(payload.ts)
        else if (payload.clientMsgId === id || action.depends_on === id) {
          actions.push(action.kind === 'delete' ? 'delete' : 'change')
          if (action.kind === 'delete' && payload.ts !== null) userDeletes.push(payload.ts)
        }
      }
      return { row, due, sentTs, keptCopies, copyDeletes, actions, userDeletes }
    },
  }
}
