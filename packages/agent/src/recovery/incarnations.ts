/**
 * Journal incarnations (plan v3 §3; spec `rotate`, `journalIdentityUnique`).
 * Each journal file belongs to one incarnation, a UUIDv7 that is never
 * reused. A rotation commits the new incarnation in `agent.sqlite` before the
 * new file exists, so the store always names the journal to open; files of
 * retired incarnations are deleted, never reopened.
 */
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { crashPoint } from '../runtime/crash'
import { JOURNAL_FILE } from '../runtime/journal'
import { transaction } from '../store/database'
import { uuidv7, type Store } from '../store/store'

export type RetireReason = 'rotation' | 'rollback' | 'restore'

export function currentIncarnation(store: Store): string | undefined {
  return (store.db.prepare('SELECT id FROM incarnations WHERE retired_at IS NULL').get() as { id: string } | undefined)?.id
}

/** The current incarnation, created on first open. */
export function ensureIncarnation(store: Store): string {
  return transaction(store.db, () => {
    const current = currentIncarnation(store)
    if (current !== undefined) return current
    const id = uuidv7(store.now())
    store.db.prepare('INSERT INTO incarnations (id, created_at) VALUES (?, ?)').run(id, store.now())
    return id
  })
}

/**
 * Spec `rotate`: retires the current incarnation and commits a fresh one, and
 * in the same transaction marks every op whose run did not finish in the old
 * journal `interrupted` (the owner sees "Juno was interrupted").
 */
export function commitRotation(store: Store, reason: RetireReason): string {
  const id = transaction(store.db, () => {
    const old = currentIncarnation(store)
    const next = uuidv7(store.now())
    if (old !== undefined) {
      store.db.prepare('UPDATE incarnations SET retired_at = ?, retired_reason = ? WHERE id = ?').run(store.now(), reason, old)
      store.db
        .prepare("UPDATE inbox SET state = 'interrupted', reason = ?, ended_at = ? WHERE state = 'submitted' AND incarnation = ?")
        .run(reason, store.now(), old)
    }
    store.db.prepare('INSERT INTO incarnations (id, created_at) VALUES (?, ?)').run(next, store.now())
    return next
  })
  crashPoint('rotation.committed')
  return id
}

/** Deletes journal files that do not belong to the current incarnation (a rotation that crashed before its cleanup). */
export function deleteRetiredJournals(agentDir: string, current: string): void {
  for (const name of readdirSync(agentDir)) {
    const match = JOURNAL_FILE.exec(name)
    if (match !== null && match[1] !== current) rmSync(join(agentDir, name), { force: true })
  }
}

/**
 * The lowest last commit a journal of this incarnation may have and resume:
 * the archive cursor, or the position of its latest authorization if higher.
 */
export function resumeFloor(store: Store, incarnation: string): number {
  const row = store.db.prepare('SELECT max(cursor, authorized_seq) AS floor FROM incarnations WHERE id = ?').get(incarnation) as { floor: number } | undefined
  return row?.floor ?? 0
}

export function incarnations(store: Store): ReadonlyArray<{ readonly id: string; readonly cursor: number; readonly retiredReason: RetireReason | null }> {
  return store.db.prepare('SELECT id, cursor, retired_reason AS retiredReason FROM incarnations ORDER BY rowid').all() as Array<{
    id: string
    cursor: number
    retiredReason: RetireReason | null
  }>
}
