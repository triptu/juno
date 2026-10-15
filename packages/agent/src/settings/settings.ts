/**
 * Settings › Juno (SPEC 13.10, plan v3 §7.1, §5.4): the page and the
 * owner's changes, over the running engine.
 *
 * - Models: one row per family, resolved in the picker's rows (OpenRouter's
 *   catalogue, read at start and then once a day; pi-ai's own until then).
 *   The saved choice is the family. A change, or a catalogue refresh that
 *   brings a newer model of a saved family, reaches the engine through
 *   `setModels`: the chat model from the next run, the compaction model
 *   from the next compaction job.
 * - Spend: today's spend from the WP9 ledger (actual plus unknown spend),
 *   and the cap. A new cap applies today at once and is saved for later
 *   days; it may not go below what today has already committed.
 * - The OpenRouter key: only whether there is one, and whether OpenRouter
 *   rejected it. The key itself stays with main and the provider.
 * - Pause: the run mode. Pausing asks every running job to stop (SPEC
 *   13.9). With AI assist off the mode stays `off`.
 * - Rules: the owner's rules (`actions/rules.ts`), replaced as a whole list.
 *   The model reads them with Juno's instructions from the next request.
 *
 * Not yet served, each with its work package: Codex (WP20; shown as not
 * installed), the backup folder (WP21; the default folder, with no backup
 * taken) and ownership changes (WP21; read only).
 */
import { join } from 'node:path'
import type { JunoSettingsPage, ModelChoice, Ownership, SettingsChange } from '@juno/agent-contract'
import { pickerFamilies, type PickerModel } from '../providers/catalog'
import type { ModelPicker, OpenRouterKey } from '../providers/openrouter'
import type { Turns } from '../router/open'
import { DOLLAR, dollars } from '../spend'
import { ownerRules, setOwnerRules } from '../actions/rules'
import { modelFor, save, type Purpose } from './store'

/** How often the catalogue is checked; it is read at most once a day. */
const REFRESH_CHECK_MS = 60 * 60_000

export type SettingsResult =
  | { readonly _tag: 'done' }
  | { readonly _tag: 'refused'; readonly reason: 'invalid' | 'unavailable'; readonly message: string }

export interface JunoSettings {
  readonly page: () => JunoSettingsPage
  readonly change: (change: SettingsChange) => SettingsResult
  /** Called when the page may have changed: the catalogue, the key, a run's spend. */
  readonly subscribe: (listener: () => void) => () => void
  /** Resolves after the first catalogue read, whatever its outcome. */
  readonly ready: Promise<void>
  readonly close: () => void
}

export interface SettingsOptions {
  readonly turns: Turns
  /** The picker the provider serves from. */
  readonly picker: ModelPicker
  readonly key?: OpenRouterKey
  readonly agentDir: string
  readonly onReport?: (error: unknown) => void
}

const money = (usd: number) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`)
/** "Anthropic: Claude Sonnet 5.5" is listed as "Claude Sonnet 5.5". */
const shortName = (name: string) => name.replace(/^[^:]+:\s*/, '')
const ref = (row: PickerModel | undefined) => (row === undefined ? undefined : { provider: row.model.provider, modelId: row.model.id })

export function createJunoSettings(options: SettingsOptions): JunoSettings {
  const { turns } = options
  const { store } = turns
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }

  const rows = () => options.picker.rows()

  /** Points the engine at the saved families' models in today's rows. */
  const apply = () => {
    const chat = ref(modelFor(store, rows(), 'chat'))
    const compaction = ref(modelFor(store, rows(), 'compaction'))
    turns.setModels({ ...(chat ? { chat } : {}), ...(compaction ? { compaction } : {}) })
  }

  const refresh = async () => {
    try {
      if (!(await options.picker.refresh(store))) return
    } catch (error) {
      // Offline with no cached catalogue: pi-ai's rows stay.
      options.onReport?.(error)
      return
    }
    turns.guard.refreshModels()
    apply()
    changed()
  }
  const ready = refresh()
  const timer = setInterval(() => void refresh(), REFRESH_CHECK_MS)
  timer.unref()

  const offTurns = turns.subscribe((event) => {
    if (event._tag !== 'ended') return
    if (event.ending._tag === 'failed' && event.ending.reason === 'keyRejected') options.key?.rejected()
    changed()
  })
  const offKey = options.key?.subscribe(changed)

  const choices = (purpose: Purpose): ReadonlyArray<ModelChoice> => {
    const all = rows()
    const selected = modelFor(store, all, purpose)?.choice.family
    return pickerFamilies
      .filter((family) => family.path === purpose)
      .map((family) => {
        const row = all.find((r) => r.choice.family === family.family && r.choice.provider === 'openrouter')
        return {
          family: family.label,
          ...(row === undefined ? {} : { resolved: shortName(row.model.name) }),
          provider: 'openrouter',
          ...(row?.price === undefined ? {} : { price: `${money(row.price.input)} / ${money(row.price.output)} per million tokens` }),
          selected: row !== undefined && family.family === selected,
        }
      })
  }

  const ownership = (): Ownership => {
    const row = store.db.prepare('SELECT state, epoch FROM ownership WHERE singleton = 1').get() as { state: Ownership['_tag']; epoch: number }
    return row.state === 'recovery' ? { _tag: 'recovery', pending: 0 } : { _tag: row.state, epoch: Number(row.epoch) }
  }

  const page = (): JunoSettingsPage => {
    const spend = turns.guard.spend.snapshot()
    return {
      chatModels: choices('chat'),
      compactionModels: choices('compaction'),
      spentTodayUsd: (spend.actual + spend.unknown) / DOLLAR,
      capUsd: spend.cap / DOLLAR,
      codex: { _tag: 'missing' },
      openRouterKey: options.key?.status() ?? 'missing',
      rules: ownerRules(store),
      paused: turns.mode() === 'paused',
      backupFolder: join(options.agentDir, 'backup'),
      ownership: ownership(),
    }
  }

  const change = (next: SettingsChange): SettingsResult => {
    switch (next._tag) {
      case 'model': {
        if (next.provider !== 'openrouter') return { _tag: 'refused', reason: 'unavailable', message: 'Codex is not available yet.' }
        const family = pickerFamilies.find((f) => f.label === next.family && f.path === next.purpose)
        const row = family === undefined ? undefined : rows().find((r) => r.choice.family === family.family && r.choice.provider === 'openrouter')
        if (family === undefined || row === undefined) return { _tag: 'refused', reason: 'invalid', message: `${next.family} is not available.` }
        save(store, next.purpose === 'chat' ? { chat: family.family } : { compaction: family.family })
        apply()
        break
      }
      case 'cap': {
        const cap = dollars(next.usd)
        if (!turns.guard.spend.setCap(cap)) return { _tag: 'refused', reason: 'invalid', message: 'Today has already used more than that.' }
        save(store, { cap })
        break
      }
      case 'paused': {
        if (turns.mode() === 'off') return { _tag: 'refused', reason: 'unavailable', message: 'AI assist is off.' }
        turns.setMode(next.value ? 'paused' : 'on')
        if (next.value) for (const job of turns.jobs.active()) void turns.jobs.stop(job.id).catch(options.onReport)
        break
      }
      case 'rules':
        if (setOwnerRules(store, next.rules) === 'invalid') return { _tag: 'refused', reason: 'invalid', message: 'Each rule is one line of up to 280 bytes, and there are at most 20.' }
        break
      case 'backupFolder':
        return { _tag: 'refused', reason: 'unavailable', message: 'Backup is not available yet.' }
    }
    changed()
    return { _tag: 'done' }
  }

  return {
    page,
    change,
    ready,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: () => {
      clearInterval(timer)
      offTurns()
      offKey?.()
    },
  }
}
