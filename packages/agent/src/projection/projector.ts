/**
 * The projection (plan v3 §3; spec `project`, `projectionPrefix`). It tails
 * the root conversation's commits in order and, for each, writes the archive
 * messages, queues their memory keys and advances the incarnation's cursor
 * to that commit, in one FULL transaction. So the archive is always an exact
 * prefix of the journal: a crash loses no projected commit and never
 * projects one twice, and the cursor never passes the journal (G8).
 *
 * Commits that add no entries (streaming partials, task state) do not move
 * the cursor; it is the position of the last commit that added entries.
 */
import { transaction } from '../store/database'
import { enqueue } from '../store/memory'
import type { Store } from '../store/store'
import type { Journal, JournalCommit } from '../runtime/journal'
import { chunks, render } from './render'

export function cursor(store: Store, incarnation: string): number {
  return (store.db.prepare('SELECT cursor FROM incarnations WHERE id = ?').get(incarnation) as { cursor: number } | undefined)?.cursor ?? 0
}

/** The op of the newest input projected: messages a run writes belong to it. */
function lastOrigin(store: Store): string | null {
  const row = store.db.prepare("SELECT origin_op AS op FROM messages WHERE kind IN ('user', 'card', 'wake', 'work') ORDER BY id DESC LIMIT 1").get() as { op: string | null } | undefined
  return row?.op ?? null
}

/** Projects one commit. A commit at or below the cursor was projected already and changes nothing. */
export function projectCommit(store: Store, incarnation: string, commit: JournalCommit): void {
  const { db, now } = store
  transaction(db, () => {
    if (commit.seq <= cursor(store, incarnation)) return
    let origin = lastOrigin(store)
    let next = (db.prepare('SELECT coalesce(max(id) + 1, 0) AS id FROM messages').get() as { id: number }).id
    const insert = db.prepare(
      'INSERT INTO messages (id, kind, text, bytes, at, origin_op, incarnation, source_pos, entry_id, chunk) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    for (const entry of commit.entries) {
      const message = render(entry)
      if (message === undefined) continue
      if (message.opId !== undefined) origin = message.opId
      const first = next
      chunks(message.text).forEach((text, chunk) => {
        insert.run(next, message.kind, text, Buffer.byteLength(text, 'utf8'), message.at ?? now(), origin, incarnation, commit.seq, entry.id, chunk)
        enqueue(store, next)
        next += 1
      })
      if (message.attachment !== undefined) db.prepare('INSERT INTO attachments (message_id, body) VALUES (?, ?)').run(first, JSON.stringify(message.attachment))
    }
    db.prepare('UPDATE incarnations SET cursor = ? WHERE id = ?').run(commit.seq, incarnation)
  })
}

/**
 * Projects every commit after the cursor. Calls are serialized: a call while
 * one runs waits for it and then runs once more.
 */
export function projector(store: Store, journal: Journal) {
  let running: Promise<void> = Promise.resolve()
  let again = false
  let pending = false
  const drain = async () => {
    for (;;) {
      const commits = await journal.commitsAfter(cursor(store, journal.incarnation), 64)
      if (commits.length === 0) return
      for (const commit of commits) projectCommit(store, journal.incarnation, commit)
    }
  }
  const catchUp = (): Promise<void> => {
    if (pending) {
      again = true
      return running
    }
    pending = true
    running = (async () => {
      try {
        do {
          again = false
          await drain()
        } while (again)
      } finally {
        pending = false
      }
    })()
    return running
  }
  return { catchUp }
}
