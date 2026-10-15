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
 * Pause and AI off revoke every grant; a job's Stop and a schedule's
 * deletion revoke that one. A removal revokes the grants minted by runs that
 * saw the removed messages and carries the rest into the new memory
 * generation (spec `redact`). A revoked grant stays as a record and is never
 * live again: after Resume, steering a job needs a card.
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
 * of the current memory generation: minted in it, or carried into it by the
 * removal that moved it (`revokeExposedGrants`).
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

/** Revokes every live grant: Pause or AI off. */
export function revokeAllGrants(store: Store, by: 'pause' | 'off'): number {
  return joined(store, () =>
    Number(store.db.prepare('UPDATE grants SET revoked_at = ?, revoked_by = ? WHERE revoked_at IS NULL').run(store.now(), by).changes),
  )
}

/**
 * The run whose content a grant's authority acted on: the run its op was an
 * input of, the run that proposed the card its op clicked, or, for a job, the
 * run that started it. Undefined when none is known.
 */
function mintingRun(store: Store, row: { readonly source_op: string; readonly op_class: GrantClass; readonly target: string }): string | undefined {
  const input = store.db.prepare('SELECT run_id AS runId FROM run_inputs WHERE op_id = ?').get(row.source_op) as { runId: string } | undefined
  if (input !== undefined) return input.runId
  const card = store.db
    .prepare('SELECT cards.run_id AS runId FROM approvals JOIN cards ON cards.id = approvals.card_id WHERE approvals.op_id = ? LIMIT 1')
    .get(row.source_op) as { runId: string } | undefined
  if (card !== undefined) return card.runId
  if (row.op_class !== 'job') return undefined
  return (store.db.prepare('SELECT run_id AS runId FROM jobs WHERE id = ?').get(row.target) as { runId: string } | undefined)?.runId
}

/**
 * A removal, inside its transaction after `gen` moved (spec `redact`):
 * revokes every live grant minted by a run that saw the removed messages, and
 * carries the others into generation `gen`, so an unrelated schedule keeps
 * waking. A menu grant (a reply watch) read nothing from the chat and is
 * kept; a grant whose run cannot be found is revoked. Returns how many it
 * revoked.
 */
export function revokeExposedGrants(store: Store, runsThatSaw: ReadonlySet<string>, gen: number): number {
  return joined(store, () => {
    const rows = store.db.prepare('SELECT id, op_class, target, authority, source_op FROM grants WHERE revoked_at IS NULL').all() as Array<{
      id: string; op_class: GrantClass; target: string; authority: GrantAuthority['_tag']; source_op: string
    }>
    const revoke = store.db.prepare("UPDATE grants SET revoked_at = ?, revoked_by = 'redaction' WHERE id = ?")
    const carry = store.db.prepare('UPDATE grants SET source_gen = ? WHERE id = ?')
    let revoked = 0
    for (const row of rows) {
      const run = row.authority === 'menu' ? null : mintingRun(store, row)
      if (run !== null && (run === undefined || runsThatSaw.has(run))) {
        revoke.run(store.now(), row.id)
        revoked += 1
      } else carry.run(gen, row.id)
    }
    return revoked
  })
}
