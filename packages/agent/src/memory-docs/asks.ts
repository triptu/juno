/**
 * Juno's proactive asks (SPEC 13.6, 13.8): something Juno offers to do that
 * the owner may want, shown in the chat and as a Home card until the owner
 * answers. Only Juno's own code offers one, never the model, and an ask runs
 * nothing until the owner accepts it.
 *
 * One kind so far, `learn`: a background pass that reads the owner's own
 * Slack messages and connected sources that hold their context (Littlebird,
 * Notion) and fills Juno's memory of them. It is offered once after setup,
 * existing owners included, and again when such a connection is added
 * later. A connection already there when the setup ask was made is covered
 * by it.
 */
import { transaction } from '../store/database'
import { uuidv7, type Store } from '../store/store'

export type AskState = 'open' | 'running' | 'done' | 'failed' | 'stopped' | 'dismissed' | 'covered'

export interface Ask {
  readonly id: string
  readonly kind: 'learn'
  readonly reason: 'setup' | 'connection'
  /** The connection's name for `connection`; '' for setup. */
  readonly connection: string
  readonly state: AskState
  /** While running, what the pass does now; once settled, the after-line's numbers. */
  readonly line: string | null
  readonly result: LearnResult | null
  readonly at: number
  readonly settledAt: number | null
}

/** What a pass did, for the after-line: how many entries it wrote. */
export interface LearnResult {
  readonly written: number
  /** Why it ended early: `budget` (today's AI limit), `paused`, `failed` (the model did not answer), `noModel`. */
  readonly ended?: 'budget' | 'paused' | 'failed' | 'noModel' | 'interrupted'
}

/** Connections whose data is about the owner, so a pass can learn from them. */
export const CONTEXT_CONNECTIONS: ReadonlyMap<string, string> = new Map([['littlebird', 'Littlebird'], ['notion', 'Notion']])

type Row = { id: string; kind: 'learn'; reason: Ask['reason']; connection: string; state: AskState; line: string | null; result: string | null; at: number; settled_at: number | null }
const askOf = (row: Row): Ask => ({
  id: row.id, kind: row.kind, reason: row.reason, connection: row.connection, state: row.state, line: row.line,
  result: row.result === null ? null : (JSON.parse(row.result) as LearnResult), at: row.at, settledAt: row.settled_at,
})

/** Every ask, oldest first. */
export function asks(store: Store): ReadonlyArray<Ask> {
  return (store.db.prepare("SELECT * FROM juno_asks WHERE state != 'covered' ORDER BY at, id").all() as unknown as Row[]).map(askOf)
}

export function ask(store: Store, id: string): Ask | undefined {
  const row = store.db.prepare('SELECT * FROM juno_asks WHERE id = ?').get(id) as Row | undefined
  return row === undefined ? undefined : askOf(row)
}

/**
 * The setup ask, once ever. `ready` names the context connections already
 * connected: the setup pass reads them, so they get no ask of their own.
 * Answers whether a new ask was made.
 */
export function offerSetup(store: Store, ready: ReadonlyArray<string>): boolean {
  return transaction(store.db, () => {
    const made = store.db.prepare("INSERT OR IGNORE INTO juno_asks (id, kind, reason, connection, state, at) VALUES (?, 'learn', 'setup', '', 'open', ?)").run(uuidv7(store.now()), store.now())
    if (Number(made.changes) === 0) return false
    for (const id of ready) cover(store, id)
    return true
  })
}

function cover(store: Store, connection: string): void {
  store.db.prepare("INSERT OR IGNORE INTO juno_asks (id, kind, reason, connection, state, at, settled_at) VALUES (?, 'learn', 'connection', ?, 'covered', ?, ?)")
    .run(uuidv7(store.now()), connection, store.now(), store.now())
}

/**
 * A context connection is ready: offer a pass for it, once, unless the
 * setup ask covers it or is still waiting for an answer (its pass will read
 * the connection too). Answers whether a new ask was made.
 */
export function offerConnection(store: Store, connection: string): boolean {
  return transaction(store.db, () => {
    const setup = store.db.prepare("SELECT state FROM juno_asks WHERE kind = 'learn' AND reason = 'setup'").get() as { state: AskState } | undefined
    if (setup === undefined) return false
    if (setup.state === 'open' || setup.state === 'running') {
      cover(store, connection)
      return false
    }
    const made = store.db.prepare("INSERT OR IGNORE INTO juno_asks (id, kind, reason, connection, state, at) VALUES (?, 'learn', 'connection', ?, 'open', ?)").run(uuidv7(store.now()), connection, store.now())
    return Number(made.changes) > 0
  })
}

/** Not now: the ask goes from the chat and Home, and is not offered again. */
export function dismiss(store: Store, id: string): boolean {
  const changed = store.db.prepare("UPDATE juno_asks SET state = 'dismissed', settled_at = ? WHERE id = ? AND state = 'open'").run(store.now(), id)
  return Number(changed.changes) > 0
}

/** The owner accepted, or tried again after a pass that ended early. */
export function begin(store: Store, id: string): boolean {
  const changed = store.db.prepare("UPDATE juno_asks SET state = 'running', line = NULL, result = NULL, settled_at = NULL WHERE id = ? AND state IN ('open', 'failed', 'stopped')").run(id)
  return Number(changed.changes) > 0
}

/** The pass's live line. */
export function progress(store: Store, id: string, line: string): void {
  store.db.prepare("UPDATE juno_asks SET line = ? WHERE id = ? AND state = 'running'").run(line, id)
}

export function settle(store: Store, id: string, state: 'done' | 'failed' | 'stopped', result: LearnResult): void {
  store.db.prepare("UPDATE juno_asks SET state = ?, line = NULL, result = ?, settled_at = ? WHERE id = ? AND state = 'running'").run(state, JSON.stringify(result), store.now(), id)
}

/** Passes the last process left running. */
export function running(store: Store): ReadonlyArray<Ask> {
  return (store.db.prepare("SELECT * FROM juno_asks WHERE state = 'running' ORDER BY at").all() as unknown as Row[]).map(askOf)
}
