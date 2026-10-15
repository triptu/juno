/**
 * Ownership's records and transitions (plan v3 §14.1 to §14.3; spec
 * `agent-recovery.qnt` `releaseOwner`, `observeOwner`, `install`,
 * `activate`). Each is one FULL transaction on `agent.sqlite`.
 *
 * `ownership { device_id, epoch, state }` is the core row the dispatcher
 * reads: it authorizes only while `state = active`. It is local: the
 * backup manifest carries it instead, so a restore can never bring back
 * another Mac's `active`.
 *
 *   active   ─move─▶ released          (this Mac is read-only for good)
 *   active   ─newer owner seen─▶ released
 *   (restore) ─install─▶ recovery ─Activate─▶ active, epoch + 1
 */
import { commitRotation } from '../recovery/incarnations'
import type { StagedRestore } from '../backup/restore'
import { transaction } from '../store/database'
import type { Store } from '../store/store'

export type OwnerState = 'active' | 'released' | 'recovery'

export interface Owner {
  readonly device: string
  readonly epoch: number
  readonly state: OwnerState
  /** The Mac that owns Juno now, when it is not this one. */
  readonly deviceName?: string
  /** The move code: on the old Mac after a move, on the new Mac until Activate. */
  readonly moveCode?: string
  /** Recovery: when the restored backup was taken. */
  readonly backupAt?: number
  /** Recovery: false when no trusted deletion record checked the install (G13). */
  readonly trusted: boolean
}

interface Row {
  readonly device: string
  readonly epoch: number
  readonly state: OwnerState
  readonly device_name: string | null
  readonly move_code: string | null
  readonly backup_at: number | null
  readonly trusted: number | null
}

export function ownerOf(store: Store): Owner {
  const row = store.db
    .prepare(
      `SELECT o.device_id AS device, o.epoch, o.state, d.device_name, d.move_code, d.backup_at, d.trusted
       FROM ownership o LEFT JOIN ownership_detail d ON d.singleton = 1 WHERE o.singleton = 1`,
    )
    .get() as unknown as Row
  return {
    device: row.device,
    epoch: Number(row.epoch),
    state: row.state,
    ...(row.device_name === null ? {} : { deviceName: row.device_name }),
    ...(row.move_code === null ? {} : { moveCode: row.move_code }),
    ...(row.backup_at === null ? {} : { backupAt: Number(row.backup_at) }),
    trusted: row.trusted !== 0,
  }
}

const setDetail = (store: Store, detail: { readonly deviceName?: string | null; readonly moveCode?: string | null; readonly backupAt?: number | null; readonly trusted?: number | null }) => {
  store.db.prepare('INSERT OR IGNORE INTO ownership_detail (singleton) VALUES (1)').run()
  for (const [column, value] of [['device_name', detail.deviceName], ['move_code', detail.moveCode], ['backup_at', detail.backupAt], ['trusted', detail.trusted]] as const) {
    if (value !== undefined) store.db.prepare(`UPDATE ownership_detail SET ${column} = ? WHERE singleton = 1`).run(value)
  }
}

/** Spec `releaseOwner` (§14.2 step 2): from here this Mac admits and authorizes nothing, also after a restart. */
export function releaseOwner(store: Store): void {
  transaction(store.db, () => {
    store.db.prepare("UPDATE ownership SET state = 'released', at = ? WHERE singleton = 1 AND state = 'active'").run(store.now())
    setDetail(store, { moveCode: null, deviceName: null })
  })
}

/** §14.2 step 4: the code of the published final manifest. */
export function recordMoveCode(store: Store, code: string): void {
  transaction(store.db, () => setDetail(store, { moveCode: code }))
}

/** Spec `observeOwner` (G7): a newer owner's manifest is in the folder. This Mac stops. */
export function observeOwner(store: Store, deviceName: string): void {
  transaction(store.db, () => {
    store.db.prepare("UPDATE ownership SET state = 'released', at = ? WHERE singleton = 1").run(store.now())
    setDetail(store, { deviceName })
  })
}

/**
 * Spec `install`, finished in the opened store (§14.3): a new journal
 * incarnation, this Mac's device id with the backup's epoch in
 * `recovery`, and every click that was not yet authorized voided, so it
 * cannot run without a new click. Authorizations without a receipt become
 * `unknown` at recovery (`classifyAtStartup`). Idempotent.
 */
export function enterRecovery(store: Store, restore: StagedRestore): void {
  commitRotation(store, 'restore')
  transaction(store.db, () => {
    store.db
      .prepare("INSERT OR REPLACE INTO ownership (singleton, device_id, epoch, state, at) VALUES (1, ?, ?, 'recovery', ?)")
      .run(restore.device, restore.epoch, store.now())
    setDetail(store, { deviceName: null, moveCode: restore.moveCode ?? null, backupAt: restore.backupAt, trusted: restore.trusted ? 1 : 0 })
    store.db
      .prepare('DELETE FROM approvals WHERE refused IS NULL AND NOT EXISTS (SELECT 1 FROM authorizations WHERE authorizations.intent_id = approvals.intent_id)')
      .run()
    store.db.prepare('INSERT OR REPLACE INTO backup_progress (singleton, folder, gen, phrase) VALUES (1, ?, ?, ?)').run(
      restore.folder,
      restore.gen,
      restore.phrase === undefined ? null : JSON.stringify(restore.phrase),
    )
  })
}

/**
 * Spec `activate` (§14.3): cards still open expire, and this Mac owns Juno
 * at the next epoch. Clicks made on the Review page stay and run.
 */
export function activateOwner(store: Store): void {
  transaction(store.db, () => {
    store.db
      .prepare(
        `UPDATE cards SET expired_at = ?
         WHERE kind != 'task' AND expired_at IS NULL AND dismissed_at IS NULL AND replaced_by IS NULL
           AND NOT EXISTS (SELECT 1 FROM approvals WHERE approvals.card_id = cards.id)
           AND NOT EXISTS (SELECT 1 FROM intents JOIN authorizations ON authorizations.intent_id = intents.id WHERE intents.card_id = cards.id)`,
      )
      .run(store.now())
    store.db.prepare("UPDATE ownership SET state = 'active', epoch = epoch + 1, at = ? WHERE singleton = 1 AND state = 'recovery'").run(store.now())
    setDetail(store, { moveCode: null, backupAt: null, trusted: null, deviceName: null })
  })
}
