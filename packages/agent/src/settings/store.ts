/**
 * The owner's saved choices (`juno_settings`): the chat, compaction and
 * fallback families on OpenRouter, the model on a custom endpoint, and the
 * daily cap for days not yet started. Plain reads and writes; `settings.ts` applies a
 * change to the running engine.
 */
import { DEFAULT_CHAT_FAMILY, DEFAULT_COMPACTION_FAMILY, DEFAULT_FALLBACK_FAMILY, NO_FALLBACK, piFamilyModel, pickerFamilies, type PickerModel } from '../providers/catalog'
import type { ModelPicker } from '../providers/picker'
import { DOLLAR } from '../spend'
import type { Store } from '../store/store'

export type Purpose = 'chat' | 'compaction'

export interface Saved {
  readonly chat: string
  readonly compaction: string
  /** Nanodollars. */
  readonly cap: number
  /** The custom endpoint's model id, once chosen. */
  readonly customModel: string | null
  /** The fallback family on OpenRouter, or `NO_FALLBACK`. */
  readonly fallback: string
}

/**
 * The daily cap until the owner sets one. A first day draws art for a few
 * hundred topics (about $0.006 each, $2 for 300) inside the background half,
 * and a day of Juno chats on Sonnet costs a few dollars.
 */
const DEFAULT_CAP = 5 * DOLLAR

const DEFAULTS: Saved = { chat: DEFAULT_CHAT_FAMILY, compaction: DEFAULT_COMPACTION_FAMILY, cap: DEFAULT_CAP, customModel: null, fallback: DEFAULT_FALLBACK_FAMILY }

export function saved(store: Store): Saved {
  const row = store.db
    .prepare('SELECT chat_family AS chat, compaction_family AS compaction, cap, custom_model AS customModel, fallback_family AS fallback FROM juno_settings WHERE singleton = 1')
    .get() as { chat: string; compaction: string; cap: number; customModel: string | null; fallback: string } | undefined
  return row === undefined ? DEFAULTS : { chat: row.chat, compaction: row.compaction, cap: Number(row.cap), customModel: row.customModel, fallback: row.fallback }
}

export function save(store: Store, change: Partial<Saved>): void {
  const next = { ...saved(store), ...change }
  store.db
    .prepare(
      `INSERT INTO juno_settings (singleton, chat_family, compaction_family, cap, custom_model, fallback_family) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT (singleton) DO UPDATE SET chat_family = excluded.chat_family, compaction_family = excluded.compaction_family,
         cap = excluded.cap, custom_model = excluded.custom_model, fallback_family = excluded.fallback_family`,
    )
    .run(next.chat, next.compaction, next.cap, next.customModel, next.fallback)
}

/** The daily cap in nanodollars, for the spend ledger's new days. */
export const capOf = (store: Store): number => saved(store).cap

/** The custom endpoint's model in use: the saved id (listed or typed), else the first one listed. */
function customChoice(store: Store, picker: ModelPicker): PickerModel | undefined {
  const id = saved(store).customModel
  const rows = picker.rows().filter(row => row.choice.provider === 'custom')
  return rows.find((row) => row.model.id === id) ?? (id === null ? rows[0] : picker.typed(id))
}

/**
 * The row a purpose uses. On OpenRouter: the saved family's, else the
 * default family's (a saved family the catalogue no longer offers), else
 * the first row. On a custom endpoint, compaction uses the chat model.
 */
export function modelFor(store: Store, picker: ModelPicker, purpose: Purpose): PickerModel | undefined {
  if (purpose === 'chat' && saved(store).chat === 'codex:sol') return picker.rows().find(row => row.choice.provider === 'codex')
  if (picker.provider() === 'custom') return customChoice(store, picker)
  const usable = picker.rows().filter((row) => row.path === purpose && row.choice.provider === 'openrouter')
  const family = purpose === 'chat' ? saved(store).chat : saved(store).compaction
  const fallback = purpose === 'chat' ? DEFAULT_CHAT_FAMILY : DEFAULT_COMPACTION_FAMILY
  return usable.find((row) => row.choice.family === family) ?? usable.find((row) => row.choice.family === fallback) ?? usable[0]
}

/**
 * The fallback's row on OpenRouter: the saved family's, of either path, or
 * none when it is off or the provider is a custom endpoint, which has no
 * second maker to ask.
 */
export function fallbackModel(store: Store, picker: ModelPicker): PickerModel | undefined {
  const family = saved(store).fallback
  if (family === NO_FALLBACK || picker.provider() === 'custom') return undefined
  return picker.rows().find((row) => row.choice.provider === 'openrouter' && row.choice.family === family)
}

/**
 * The fallback's OpenRouter slug for the engine's AI jobs, which call
 * OpenRouter whatever the agent's provider is: the picker's row, else
 * pi-ai's newest model of the family, else '' (none).
 */
export function fallbackSlug(store: Store, picker: ModelPicker): string {
  const family = saved(store).fallback
  const known = pickerFamilies.find((f) => f.family === family)
  if (known === undefined) return ''
  return fallbackModel(store, picker)?.model.id ?? piFamilyModel(known.family)?.id ?? ''
}

/** Every model the provider serves now: the picker's rows and a typed custom model. */
export function servedModels(store: Store, picker: ModelPicker): readonly PickerModel['model'][] {
  const rows = picker.rows()
  const chosen = picker.provider() === 'custom' ? customChoice(store, picker) : undefined
  return [...rows, ...(chosen !== undefined && !rows.includes(chosen) ? [chosen] : [])].map((row) => row.model)
}
