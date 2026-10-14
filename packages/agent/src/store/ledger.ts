/**
 * The part of the action ledger that recovery and Pause need (plan v3 §6.1,
 * §6.3, §6.5; spec `agent-actions.qnt`). WP15's dispatcher builds on these
 * and adds intents, approvals and grants.
 *
 * Outcomes only move forward, and a receipt is never overwritten:
 *
 *   consumed ─▶ sent ─▶ done | failed
 *      │         └──▶ cancel-requested ─▶ done | failed | unknown
 *      └──▶ cancelled
 *   anything open at startup, or sent when Pause cancels ─▶ unknown ─▶ done (positive evidence)
 */
import { crashPoint } from '../runtime/crash'
import { transaction } from './database'
import { uuidv7, type Store } from './store'

export type Mode = 'on' | 'paused' | 'off'
export type Outcome = 'consumed' | 'sent' | 'cancel-requested' | 'cancelled' | 'unknown' | 'done' | 'failed'

export function mode(store: Store): Mode {
  return (store.db.prepare('SELECT mode FROM control WHERE singleton = 1').get() as { mode: Mode }).mode
}

/**
 * Pause, AI off and Resume (§6.5, §13.2). Pause and off stop new
 * authorizations and, in the same transaction, ask open work to cancel
 * (spec `pause` then `cancel`): an authorization not yet sent is cancelled;
 * one with the transport becomes `cancel-requested`, and keeps whatever
 * evidence later arrives.
 */
export function setMode(store: Store, next: Mode): void {
  transaction(store.db, () => {
    store.db.prepare('UPDATE control SET mode = ?, at = ? WHERE singleton = 1').run(next, store.now())
    if (next !== 'on') cancelOpen(store)
  })
}

/** Stop (§6.5): nothing new starts for this reply. Only the authorizations its run made are touched. */
export function cancelRun(store: Store, originOp: string): void {
  transaction(store.db, () => cancelOpen(store, originOp))
}

function cancelOpen(store: Store, originOp?: string): void {
  const scope = originOp === undefined ? '' : ' AND origin_op = ?'
  const args = originOp === undefined ? [] : [originOp]
  store.db.prepare(`UPDATE authorizations SET outcome = 'cancelled' WHERE outcome = 'consumed'${scope}`).run(...args)
  store.db.prepare(`UPDATE authorizations SET outcome = 'cancel-requested' WHERE outcome = 'sent'${scope}`).run(...args)
}

export type Authorize =
  | { readonly _tag: 'authorized'; readonly id: string }
  | { readonly _tag: 'refused'; readonly reason: 'paused' | 'off' | 'notOwner' | 'rotated' }

/** A journal position: the incarnation and its last commit, `next_seq - 1` (`Core.position`). */
export interface JournalPosition {
  readonly incarnation: string
  readonly seq: number
}

/**
 * Consumes one authorization before transport (§6.3, spec `authorize`). It
 * is refused while paused or off, and on a device that does not own Juno.
 * The dispatcher (WP15) checks approval, digest, grant and the rest first.
 *
 * `position` is the journal position read inside the tool's `execute()`,
 * after pi committed the call's execute intent. The same transaction raises
 * the incarnation's `authorized_seq` to it, and recovery never resumes a
 * journal behind it (spec `agent-recovery-replay.qnt`). Without this, an
 * older copy of the journal that lost only that intent resumes, pi runs the
 * call again, and the effect is authorized twice. The tool that sends must
 * keep pi's default `replay: "unsafe"`.
 */
export function authorize(
  store: Store,
  input: {
    readonly intentId: string
    readonly child?: number
    readonly approvalId?: string
    readonly grantId?: string
    readonly originOp?: string
    readonly position: JournalPosition
  },
): Authorize {
  const result = transaction(store.db, (): Authorize => {
    const current = mode(store)
    if (current !== 'on') return { _tag: 'refused', reason: current }
    const owner = store.db.prepare('SELECT epoch, state FROM ownership WHERE singleton = 1').get() as { epoch: number; state: string }
    if (owner.state !== 'active') return { _tag: 'refused', reason: 'notOwner' }
    const raised = store.db
      .prepare('UPDATE incarnations SET authorized_seq = max(authorized_seq, ?) WHERE id = ? AND retired_at IS NULL')
      .run(input.position.seq, input.position.incarnation)
    if (raised.changes === 0) return { _tag: 'refused', reason: 'rotated' }
    const id = uuidv7(store.now())
    store.db
      .prepare(
        "INSERT INTO authorizations (id, intent_id, child, approval_id, grant_id, epoch, origin_op, consumed_at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'consumed')",
      )
      .run(id, input.intentId, input.child ?? 0, input.approvalId ?? null, input.grantId ?? null, owner.epoch, input.originOp ?? null, store.now())
    return { _tag: 'authorized', id }
  })
  if (result._tag === 'authorized') crashPoint('authorization.consumed')
  return result
}

/** Hands a consumed authorization to the transport (spec `send`). Returns the attempt, or undefined if it may not be sent. */
export function recordAttempt(store: Store, authorizationId: string): string | undefined {
  return transaction(store.db, () => {
    const changed = store.db.prepare("UPDATE authorizations SET outcome = 'sent' WHERE id = ? AND outcome = 'consumed'").run(authorizationId)
    if (changed.changes === 0) return undefined
    const id = uuidv7(store.now())
    store.db.prepare('INSERT INTO attempts (id, authorization_id, at) VALUES (?, ?, ?)').run(id, authorizationId, store.now())
    return id
  })
}

/** Positive evidence for an attempt (spec `receipt`). Earlier evidence is kept. */
export function recordReceipt(store: Store, attemptId: string, evidence: unknown): void {
  transaction(store.db, () => {
    const inserted = store.db.prepare('INSERT OR IGNORE INTO receipts (attempt_id, evidence, at) VALUES (?, ?, ?)').run(attemptId, JSON.stringify(evidence), store.now())
    if (inserted.changes === 0) return
    store.db.prepare("UPDATE authorizations SET outcome = 'done' WHERE id = (SELECT authorization_id FROM attempts WHERE id = ?)").run(attemptId)
  })
}

/**
 * Startup (§6.5, spec `startup`): before pi resumes, every authorization
 * without a receipt that is still open becomes `unknown`. It is never
 * dispatched again; reconcile looks for evidence in the background.
 */
export function classifyAtStartup(store: Store): number {
  return transaction(store.db, () =>
    Number(
      store.db
        .prepare(
          `UPDATE authorizations SET outcome = 'unknown'
           WHERE outcome IN ('consumed', 'sent', 'cancel-requested')
             AND NOT EXISTS (SELECT 1 FROM attempts JOIN receipts ON receipts.attempt_id = attempts.id WHERE attempts.authorization_id = authorizations.id)`,
        )
        .run().changes,
    ),
  )
}

export function outcomes(store: Store): ReadonlyArray<{ readonly id: string; readonly outcome: Outcome }> {
  return store.db.prepare('SELECT id, outcome FROM authorizations ORDER BY id').all() as Array<{ id: string; outcome: Outcome }>
}
