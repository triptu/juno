/**
 * The owner's saved choices (`juno_settings`): the chat and compaction
 * families and the daily cap for days not yet started. Plain reads and
 * writes; `settings.ts` applies a change to the running engine.
 */
import { DEFAULT_CHAT_FAMILY, DEFAULT_COMPACTION_FAMILY, type PickerModel } from '../providers/catalog'
import { DOLLAR } from '../spend'
import type { Store } from '../store/store'

export type Purpose = 'chat' | 'compaction'

export interface Saved {
  readonly chat: string
  readonly compaction: string
  /** Nanodollars. */
  readonly cap: number
}

const DEFAULTS: Saved = { chat: DEFAULT_CHAT_FAMILY, compaction: DEFAULT_COMPACTION_FAMILY, cap: 2 * DOLLAR }

export function saved(store: Store): Saved {
  const row = store.db.prepare('SELECT chat_family AS chat, compaction_family AS compaction, cap FROM juno_settings WHERE singleton = 1').get() as
    | { chat: string; compaction: string; cap: number }
    | undefined
  return row === undefined ? DEFAULTS : { chat: row.chat, compaction: row.compaction, cap: Number(row.cap) }
}

export function save(store: Store, change: Partial<Saved>): void {
  const next = { ...saved(store), ...change }
  store.db
    .prepare(
      `INSERT INTO juno_settings (singleton, chat_family, compaction_family, cap) VALUES (1, ?, ?, ?)
       ON CONFLICT (singleton) DO UPDATE SET chat_family = excluded.chat_family, compaction_family = excluded.compaction_family, cap = excluded.cap`,
    )
    .run(next.chat, next.compaction, next.cap)
}

/** The daily cap in nanodollars, for the spend ledger's new days. */
export const capOf = (store: Store): number => saved(store).cap

/**
 * The row a purpose uses: the saved family's, else the default family's
 * (a saved family the catalogue no longer offers), else the first row.
 */
export function modelFor(store: Store, rows: readonly PickerModel[], purpose: Purpose): PickerModel | undefined {
  const usable = rows.filter((row) => row.path === purpose && row.choice.provider === 'openrouter')
  const family = purpose === 'chat' ? saved(store).chat : saved(store).compaction
  const fallback = purpose === 'chat' ? DEFAULT_CHAT_FAMILY : DEFAULT_COMPACTION_FAMILY
  return usable.find((row) => row.choice.family === family) ?? usable.find((row) => row.choice.family === fallback) ?? usable[0]
}
