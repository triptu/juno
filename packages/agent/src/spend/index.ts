import { Context, Effect, Layer } from 'effect'
import { transaction } from '../store/database'
import { uuidv7, type Store } from '../store/store'
export { SPEND_MIGRATIONS } from './schema'

/** Integer nanodollars. Round each reservation up, never down. */
export const DOLLAR = 1_000_000_000
export type SpendPath = 'chat' | 'subagent' | 'compaction' | 'engine'
export function dollars(value: number): number {
  return money(Math.ceil(value * DOLLAR))
}
function money(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid spend amount')
  return value
}
export function spendDay(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export interface SpendSnapshot {
  readonly day: string
  readonly cap: number
  readonly raises: number
  readonly reserved: number
  readonly unknown: number
  readonly actual: number
  readonly compaction: number
  readonly codexTurns: number
}
export type Reservation = { readonly kind: 'reserved'; readonly id: string } | { readonly kind: 'blocked'; readonly reason: 'budget' }

/** All paths use the same SQLite write transaction; no check crosses an await. */
export function createSpend(store: Store, cap: () => number = () => 2 * DOLLAR) {
  const { db } = store
  const today = () => spendDay(store.now())
  const ensureDay = (day: string) => db.prepare('INSERT OR IGNORE INTO spend_days(day, cap) VALUES (?, ?)').run(day, money(cap()))
  const snapshot = (day = today()): SpendSnapshot => {
    const row = db.prepare(`SELECT
      coalesce(sum(CASE WHEN state != 'settled' THEN amount ELSE 0 END), 0) AS reserved,
      coalesce(sum(CASE WHEN state = 'unknown' THEN amount ELSE 0 END), 0) AS unknown,
      coalesce(sum(actual), 0) AS actual,
      coalesce(sum(CASE WHEN path = 'compaction' THEN coalesce(actual, amount) ELSE 0 END), 0) AS compaction
      FROM spend_reservations WHERE day = ?`).get(day)!
    return {
      day,
      cap: Number(db.prepare('SELECT cap FROM spend_days WHERE day = ?').get(day)?.cap ?? cap()),
      raises: Number(db.prepare('SELECT coalesce(sum(amount), 0) AS n FROM spend_raises WHERE day = ?').get(day)!.n),
      reserved: Number(row.reserved), unknown: Number(row.unknown), actual: Number(row.actual), compaction: Number(row.compaction),
      codexTurns: Number(db.prepare('SELECT count(*) AS n FROM codex_turns WHERE day = ?').get(day)!.n),
    }
  }
  /** What one path holds today: open and unknown reservations in full, settled ones at their reported cost. */
  const usedBy = (day: string, path: SpendPath) => Number(db.prepare(
    "SELECT coalesce(sum(CASE WHEN state = 'settled' THEN actual ELSE amount END), 0) AS n FROM spend_reservations WHERE day = ? AND path = ?",
  ).get(day, path)!.n)
  /**
   * A provider may report more than was reserved, and the ledger records what
   * it reports, so a day can end above its cap. Once a day (or a path's
   * share) is at or over its limit, nothing new is reserved, whatever the
   * amount, until midnight or a raise. Compaction may use a quarter of the
   * limit and the engine's background calls half, so chat always keeps the rest.
   * The engine's backlog (`background`) stops at three eighths, counted
   * against all the engine holds, so new threads and Redraw keep the rest of
   * its half (spec `engineBackground`).
   */
  const fits = (day: string, path: SpendPath, amount: number, background = false) => {
    const s = snapshot(day)
    const limit = money(s.cap + s.raises)
    const used = s.reserved + s.actual
    if (used >= limit || used + amount > limit) return false
    const share = path === 'compaction' ? Math.floor(limit / 4) : path === 'engine' ? Math.floor(limit / 2) : undefined
    if (share === undefined) return true
    const mine = path === 'compaction' ? s.compaction : usedBy(day, path)
    if (background && path === 'engine' && mine + amount > Math.floor((limit * 3) / 8)) return false
    return mine < share && mine + amount <= share
  }
  return {
    snapshot,
    /** `as` makes the reservation idempotent: a reservation with that id already made is returned as it is. */
    reserve: (path: SpendPath, amount: number, as?: string, background = false): Reservation => transaction(db, () => {
      money(amount)
      if (as !== undefined && db.prepare('SELECT 1 FROM spend_reservations WHERE id = ?').get(as)) return { kind: 'reserved', id: as }
      const day = today()
      ensureDay(day)
      if (!fits(day, path, amount, background)) return { kind: 'blocked', reason: 'budget' }
      const id = as ?? uuidv7(store.now())
      db.prepare("INSERT INTO spend_reservations(id, day, path, amount, state) VALUES (?, ?, ?, ?, 'reserved')").run(id, day, path, amount)
      return { kind: 'reserved', id }
    }),
    /** The adapter may add wire framing. Increase its reservation before transport. */
    extend: (id: string, amount: number): boolean => transaction(db, () => {
      money(amount)
      const row = db.prepare("SELECT day, path, amount FROM spend_reservations WHERE id = ? AND state = 'reserved'").get(id)
      if (!row) return false
      const path = row.path
      if (path !== 'chat' && path !== 'subagent' && path !== 'compaction' && path !== 'engine') throw new Error('Invalid spend path')
      if (amount <= Number(row.amount)) return true
      if (!fits(String(row.day), path, amount - Number(row.amount))) return false
      db.prepare('UPDATE spend_reservations SET amount = ? WHERE id = ?').run(amount, id)
      return true
    }),
    /**
     * Known usage releases the rest of the reservation. It is recorded as
     * reported, also when it is more than was reserved: the ledger never
     * records less than the provider charged. Unknown usage keeps all of the
     * reservation for that day, including after a restart, and is final (spec
     * `settleSpend`). Only the first settlement counts.
     */
    settle: (id: string, actual: number | undefined): void => {
      if (actual !== undefined) money(actual)
      db.prepare(`UPDATE spend_reservations SET state = ?, actual = ? WHERE id = ? AND state = 'reserved'`)
        .run(actual === undefined ? 'unknown' : 'settled', actual ?? null, id)
    },
    /** A trusted owner click, keyed by its durable operation id. Never expose this as a model tool. */
    allowDollar: (clickId: string): void => transaction(db, () => {
      const day = today()
      ensureDay(day)
      money(snapshot(day).cap + snapshot(day).raises + DOLLAR)
      db.prepare('INSERT OR IGNORE INTO spend_raises(id, day, amount) VALUES (?, ?, ?)').run(clickId, day, DOLLAR)
    }),
    /** A lower cap blocks new reservations; existing reservations still settle. */
    setCap: (amount: number): boolean => transaction(db, () => {
      money(amount)
      const day = today()
      ensureDay(day)
      db.prepare('UPDATE spend_days SET cap = ? WHERE day = ?').run(amount, day)
      return true
    }),
    countCodex: (home: string): string => {
      const id = uuidv7(store.now())
      db.prepare('INSERT INTO codex_turns(id, day, home) VALUES (?, ?, ?)').run(id, today(), home)
      return id
    },
    recordThread: (id: string, threadId: string): void => {
      db.prepare('UPDATE codex_turns SET thread_id = ? WHERE id = ?').run(threadId, id)
    },
  }
}
export type SpendLedger = ReturnType<typeof createSpend>
export class Spend extends Context.Service<Spend, SpendLedger>()('juno/agent/Spend') {
  static layer(store: Store, cap?: () => number): Layer.Layer<Spend> {
    return Layer.effect(Spend, Effect.sync(() => createSpend(store, cap)))
  }
}
