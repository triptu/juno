/**
 * The inbox (plan v3 §3; spec `acceptInput`, `acknowledge`, `markSubmitted`).
 *
 * An owner send, steer, retry, card click, wake or report is written here
 * at FULL before it is acknowledged, so the renderer clears its pending
 * state only for input that survives power loss. "Not delivered" means this
 * write failed. Each op carries a stable `op_id` (UUIDv7, minted by the
 * sender), so accepting the same op twice is one row.
 */
import { crashPoint } from '../runtime/crash'
import { transaction } from '../store/database'
import { mode } from '../store/ledger'
import type { Store } from '../store/store'

export type InboxKind = 'send' | 'steer' | 'retry' | 'wake' | 'report' | 'click'
export type InboxState = 'accepted' | 'submitted' | 'done' | 'interrupted' | 'stopped' | 'failed'

export interface InboxOp {
  readonly seq: number
  readonly opId: string
  readonly kind: InboxKind
  readonly text: string
  readonly at: number
  readonly state: InboxState
  readonly incarnation: string | null
  readonly submissionId: string | null
  readonly reason: string | null
}

/** §13.2: longer text is refused locally ("failed: tooLong"). */
export const MAX_INPUT_BYTES = 65_536

export type Accept =
  | { readonly _tag: 'accepted'; readonly op: InboxOp }
  /** Nothing was written: AI is off (the composer is disabled), or the text is over 64 KB. */
  | { readonly _tag: 'refused'; readonly reason: 'off' | 'tooLong' }

export function accept(store: Store, input: { readonly opId: string; readonly kind: InboxKind; readonly text: string; readonly data?: unknown }): Accept {
  if (Buffer.byteLength(input.text, 'utf8') > MAX_INPUT_BYTES) return { _tag: 'refused', reason: 'tooLong' }
  const result = transaction(store.db, (): Accept => {
    const existing = find(store, input.opId)
    if (existing !== undefined) return { _tag: 'accepted', op: existing }
    if (mode(store) === 'off' && input.kind !== 'click') return { _tag: 'refused', reason: 'off' }
    store.db
      .prepare("INSERT INTO inbox (op_id, kind, text, data, at, state) VALUES (?, ?, ?, ?, ?, 'accepted')")
      .run(input.opId, input.kind, input.text, input.data === undefined ? null : JSON.stringify(input.data), store.now())
    return { _tag: 'accepted', op: find(store, input.opId)! }
  })
  if (result._tag === 'accepted') crashPoint('inbox.committed')
  return result
}

const columns = 'seq, op_id AS opId, kind, text, at, state, incarnation, submission_id AS submissionId, reason'

export function find(store: Store, opId: string): InboxOp | undefined {
  return store.db.prepare(`SELECT ${columns} FROM inbox WHERE op_id = ?`).get(opId) as InboxOp | undefined
}

export function ops(store: Store): ReadonlyArray<InboxOp> {
  return store.db.prepare(`SELECT ${columns} FROM inbox ORDER BY seq`).all() as unknown as InboxOp[]
}

/** The oldest op not yet in the journal. */
export function nextAccepted(store: Store): InboxOp | undefined {
  return store.db.prepare(`SELECT ${columns} FROM inbox WHERE state = 'accepted' ORDER BY seq LIMIT 1`).get() as InboxOp | undefined
}

/** Ops in the journal of `incarnation` whose runs have not settled, oldest first. */
export function unsettled(store: Store, incarnation: string): ReadonlyArray<InboxOp> {
  return store.db.prepare(`SELECT ${columns} FROM inbox WHERE state = 'submitted' AND incarnation = ? ORDER BY seq`).all(incarnation) as unknown as InboxOp[]
}

/** Spec `markSubmitted`: the op is in the journal as `submissionId`. */
export function markSubmitted(store: Store, opId: string, incarnation: string, submissionId: string): void {
  transaction(store.db, () => {
    store.db
      .prepare("UPDATE inbox SET state = 'submitted', incarnation = ?, submission_id = ? WHERE op_id = ? AND state = 'accepted'")
      .run(incarnation, submissionId, opId)
  })
}

/** The op's run ended. A settled op never changes again. */
export function settle(store: Store, opId: string, state: 'done' | 'interrupted' | 'stopped' | 'failed', reason?: string): void {
  transaction(store.db, () => {
    store.db
      .prepare("UPDATE inbox SET state = ?, reason = ?, ended_at = ? WHERE op_id = ? AND state IN ('accepted', 'submitted')")
      .run(state, reason ?? null, store.now(), opId)
  })
}
