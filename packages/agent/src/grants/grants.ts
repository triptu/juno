/**
 * Grants (plan v3 §6.4, §11.1, §19.2; spec `grantWith`, `grantClick`,
 * `scheduleWith`, `scheduleFromClick`, `scheduleFromMenu`, `pause`,
 * `deleteSchedule`, `invalidate("redact")`).
 *
 * A grant lets Juno act on one job or one schedule with no click: steer or
 * stop the job it started, or wake for the schedule it created. Only an
 * owner authority mints one (`policy.mayMintGrant`): a clean owner run whose
 * source op is in that run, a current card click, or the message menu's
 * reply watch. The application binds the grant to the call it made; the
 * model never names a grant, and reports, tool output and steering cannot
 * create, broaden or restore one.
 *
 * Pause, AI off and a redaction revoke every grant; a job's Stop and a
 * schedule's deletion revoke that one. A revoked grant stays as a record and
 * is never live again: after Resume, steering a job needs a card.
 */
import { mayMintGrant, type Authority, type GrantAuthority } from '../policy/policy'
import { transaction } from '../store/database'
import { uuidv7, type Store } from '../store/store'

export type GrantClass = 'job' | 'schedule'
export type Revocation = 'pause' | 'off' | 'redaction' | 'stop' | 'delete'

export interface Grant {
  readonly id: string
  readonly opClass: GrantClass
  readonly target: string
  readonly bounds: unknown
  readonly authority: GrantAuthority['_tag']
  readonly sourceOp: string
  readonly sourceGen: number
}

const memoryGen = (store: Store) => (store.db.prepare('SELECT gen FROM memory_head WHERE singleton = 1').get() as { gen: number }).gen

/** This Mac's authority now: the run mode and the ownership state. */
export function authorityOf(store: Store): Authority {
  const { mode } = store.db.prepare('SELECT mode FROM control WHERE singleton = 1').get() as { mode: Authority['mode'] }
  const { state } = store.db.prepare('SELECT state FROM ownership WHERE singleton = 1').get() as { state: Authority['owner'] }
  return { mode, owner: state }
}

export type Mint = { readonly _tag: 'minted'; readonly grant: Grant } | { readonly _tag: 'refused' }

/**
 * Mints a grant for `target` under `authority`, in one transaction with the
 * check. Minting again for a target that already has a live grant returns
 * that grant. One authority op mints a target's grant once: a replayed call
 * or a repeated click whose grant was revoked since (Pause, Stop) is
 * refused, so nothing restores a revoked grant.
 */
export function mintGrant(
  store: Store,
  input: { readonly opClass: GrantClass; readonly target: string; readonly bounds?: unknown; readonly authority: GrantAuthority; readonly sourceOp: string },
): Mint {
  return joined(store, (): Mint => {
    if (!mayMintGrant(input.authority, authorityOf(store))) return { _tag: 'refused' }
    const revoked = store.db
      .prepare('SELECT 1 FROM grants WHERE op_class = ? AND target = ? AND source_op = ? AND revoked_at IS NOT NULL')
      .get(input.opClass, input.target, input.sourceOp)
    if (revoked !== undefined) return { _tag: 'refused' }
    const live = liveGrant(store, input.opClass, input.target)
    if (live !== undefined) return { _tag: 'minted', grant: live }
    const grant: Grant = {
      id: uuidv7(store.now()), opClass: input.opClass, target: input.target, bounds: input.bounds ?? {},
      authority: input.authority._tag, sourceOp: input.sourceOp, sourceGen: memoryGen(store),
    }
    store.db
      .prepare('INSERT INTO grants (id, op_class, target, bounds, authority, source_op, source_gen, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(grant.id, grant.opClass, grant.target, JSON.stringify(grant.bounds), grant.authority, grant.sourceOp, grant.sourceGen, store.now())
    return { _tag: 'minted', grant }
  })
}

type Row = { id: string; op_class: GrantClass; target: string; bounds: string; authority: GrantAuthority['_tag']; source_op: string; source_gen: number }

/**
 * The live grant for a target, if any (spec `liveGrant`): not revoked, and
 * minted in the current memory generation, so a redaction since voids it
 * even before its revocation is written.
 */
export function liveGrant(store: Store, opClass: GrantClass, target: string): Grant | undefined {
  const row = store.db
    .prepare('SELECT id, op_class, target, bounds, authority, source_op, source_gen FROM grants WHERE op_class = ? AND target = ? AND revoked_at IS NULL')
    .get(opClass, target) as Row | undefined
  if (row === undefined || row.source_gen !== memoryGen(store)) return undefined
  return {
    id: row.id, opClass: row.op_class, target: row.target, bounds: JSON.parse(row.bounds),
    authority: row.authority, sourceOp: row.source_op, sourceGen: row.source_gen,
  }
}

/** Runs `f` in the caller's transaction, or in its own. A revocation can join the transaction that causes it. */
const joined = <T>(store: Store, f: () => T): T => (store.db.isTransaction ? f() : transaction(store.db, f))

/** Revokes one target's grant: a job's Stop, a schedule's deletion. */
export function revokeGrant(store: Store, opClass: GrantClass, target: string, by: 'stop' | 'delete'): void {
  joined(store, () => {
    store.db.prepare('UPDATE grants SET revoked_at = ?, revoked_by = ? WHERE op_class = ? AND target = ? AND revoked_at IS NULL').run(store.now(), by, opClass, target)
  })
}

/** Revokes every live grant: Pause, AI off, or a redaction (WP16 calls it inside its removal's transaction). */
export function revokeAllGrants(store: Store, by: 'pause' | 'off' | 'redaction'): number {
  return joined(store, () =>
    Number(store.db.prepare('UPDATE grants SET revoked_at = ?, revoked_by = ? WHERE revoked_at IS NULL').run(store.now(), by).changes),
  )
}
