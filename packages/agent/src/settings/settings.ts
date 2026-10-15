/**
 * Settings › Juno (SPEC 13.10, plan v3 §7.1, §5.4): the page and the
 * owner's changes, over the running engine.
 *
 * - Provider: main says which is active (OpenRouter or one OpenAI-compatible
 *   endpoint) and sends it over `parentPort`; the page lists that one's
 *   models. A switch refreshes the rows and moves the engine to the saved
 *   choice there.
 * - Models on OpenRouter: one row per family, resolved in the picker's rows
 *   (its catalogue, read at start and then once a day; pi-ai's own until
 *   then). The saved choice is the family. On a custom endpoint: one row
 *   per model its `/models` lists, or the typed model id when it lists
 *   none (`modelTyped`); compaction uses the chat model there. A change, or
 *   a refresh that brings a newer model, reaches the engine through
 *   `setModels`: the chat model from the next run, the compaction model
 *   from the next compaction job.
 * - A model with no prices (most custom endpoints) costs $0 in the ledger,
 *   so the cap cannot track it (`spendUntracked`).
 * - Spend: today's spend from the WP9 ledger (actual plus unknown spend),
 *   and the cap. A new cap applies today at once and is saved for later
 *   days; it may not go below what today has already committed.
 * - Keys: only whether the active provider refused its key on the last
 *   call. Whether each key is set is main's (`ProviderState`); the keys
 *   themselves stay with main and the provider.
 * - Pause: the run mode. Pausing asks every running job to stop (SPEC
 *   13.9). With AI assist off the mode stays `off`.
 * - Rules: the owner's rules (`actions/rules.ts`), replaced as a whole list.
 *   The model reads them with Juno's instructions from the next request.
 *
 * - Backup and This Mac (WP21): the backup folder and the last backup, when
 *   the recovery phrase was exported, and who owns Juno's state. A new
 *   folder starts a generation there. Move, restore and Activate are their
 *   own RPCs (`agent.settings.ownership`, `agent.review.activate`).
 *
 * Not yet served: Codex (WP20; shown as not installed).
 */
import { isAbsolute } from 'node:path'
import type { JunoSettingsPage, ModelChoice, Ownership, SettingsChange } from '@juno/agent-contract'
import { pickerFamilies, type PickerModel } from '../providers/catalog'
import type { ProviderConnection } from '../providers/connection'
import type { ModelPicker } from '../providers/picker'
import type { Turns } from '../router/open'
import { DOLLAR, dollars } from '../spend'
import { ownerRules, setOwnerRules } from '../actions/rules'
import { defaultBackupFolder } from '../backup/backup'
import { backupFailure } from '../backup/errors'
import { modelFor, save, type Purpose } from './store'

/** How often the catalogue is checked; it is read at most once a day. */
const REFRESH_CHECK_MS = 60 * 60_000

export type SettingsResult =
  | { readonly _tag: 'done' }
  | { readonly _tag: 'refused'; readonly reason: 'invalid' | 'unavailable' | 'readOnly'; readonly message: string }

export interface JunoSettings {
  readonly page: () => JunoSettingsPage
  /** A folder change answers once the backup is in the new folder. */
  readonly change: (change: SettingsChange) => SettingsResult | Promise<SettingsResult>
  /** Called when the page may have changed: the provider, the catalogue, a run's spend. */
  readonly subscribe: (listener: () => void) => () => void
  /** Resolves after the first catalogue read, whatever its outcome. */
  readonly ready: Promise<void>
  readonly close: () => void
}

export interface SettingsOptions {
  readonly turns: Turns
  /** The picker the provider serves from. */
  readonly picker: ModelPicker
  readonly connection: ProviderConnection
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

  const { picker, connection } = options
  const rows = () => picker.rows()

  /** Gives the guard the models served now, and points the engine at the saved choice among them. */
  const apply = () => {
    turns.guard.refreshModels()
    const chat = ref(modelFor(store, picker, 'chat'))
    const compaction = ref(modelFor(store, picker, 'compaction'))
    turns.setModels({ ...(chat ? { chat } : {}), ...(compaction ? { compaction } : {}) })
  }

  let closed = false
  /** `always`: apply even when the rows did not change, as after a provider switch. */
  const refresh = async (always = false) => {
    let rowsChanged = false
    try {
      rowsChanged = await picker.refresh(store)
    } catch (error) {
      // Offline with no cached catalogue: pi-ai's rows stay.
      options.onReport?.(error)
    }
    // The engine may have closed while the models were read.
    if (closed || (!rowsChanged && !always)) return
    apply()
    changed()
  }
  const ready = refresh()
  const timer = setInterval(() => void refresh(), REFRESH_CHECK_MS)
  timer.unref()

  const offTurns = turns.subscribe((event) => {
    if (event._tag !== 'ended') return
    if (event.ending._tag === 'failed' && event.ending.reason === 'keyRejected') connection.rejected()
    changed()
  })
  // A provider switch (or new key) from main: its models, then the page.
  const offConnection = connection.subscribe(() => void refresh(true))
  const offOwnership = turns.ownership.subscribe(changed)

  const priceText = (row: PickerModel) => (row.price === undefined ? {} : { price: `${money(row.price.input)} / ${money(row.price.output)} per million tokens` })

  /** The custom endpoint's rows: what it lists, with a typed model added when chosen. */
  const customChoices = (): ReadonlyArray<ModelChoice> => {
    const chosen = modelFor(store, picker, 'chat')
    const listed = rows()
    const all = chosen !== undefined && !listed.some((row) => row.model.id === chosen.model.id) ? [...listed, chosen] : listed
    return all.map((row) => ({ family: row.model.id, resolved: row.model.id, provider: 'custom', ...priceText(row), selected: row.model.id === chosen?.model.id }))
  }

  const choices = (purpose: Purpose): ReadonlyArray<ModelChoice> => {
    if (picker.provider() === 'custom') return purpose === 'chat' ? customChoices() : []
    const all = rows()
    const selected = modelFor(store, picker, purpose)?.choice.family
    return pickerFamilies
      .filter((family) => family.path === purpose)
      .map((family) => {
        const row = all.find((r) => r.choice.family === family.family && r.choice.provider === 'openrouter')
        return {
          family: family.label,
          ...(row === undefined ? {} : { resolved: shortName(row.model.name) }),
          provider: 'openrouter',
          ...(row === undefined ? {} : priceText(row)),
          selected: row !== undefined && family.family === selected,
        }
      })
  }

  const ownership = (): Ownership => {
    const owner = turns.ownership.owner()
    switch (owner.state) {
      case 'recovery':
        return { _tag: 'recovery', pending: turns.ownership.pending() }
      case 'released':
        return {
          _tag: 'released', epoch: owner.epoch,
          ...(owner.moveCode === undefined ? {} : { moveCode: owner.moveCode }),
          ...(owner.deviceName === undefined ? {} : { deviceName: owner.deviceName }),
        }
      case 'active':
        return { _tag: 'active', epoch: owner.epoch }
    }
  }
  const backup = turns.backup

  const page = (): JunoSettingsPage => {
    const spend = turns.guard.spend.snapshot()
    const custom = picker.provider() === 'custom'
    const active = connection.current()
    const chat = modelFor(store, picker, 'chat')
    return {
      chatModels: choices('chat'),
      compactionModels: choices('compaction'),
      spentTodayUsd: (spend.actual + spend.unknown) / DOLLAR,
      capUsd: spend.cap / DOLLAR,
      codex: { _tag: 'missing' },
      openRouterKey: active?._tag === 'openRouter' ? (connection.isRejected() ? 'rejected' : 'set') : 'missing',
      ...(custom ? { provider: 'custom' as const } : {}),
      ...(custom && connection.isRejected() ? { customKeyRejected: true as const } : {}),
      ...(custom && !picker.listed() ? { modelTyped: true as const } : {}),
      ...(chat === undefined || chat.price === undefined || (chat.price.input === 0 && chat.price.output === 0) ? { spendUntracked: true as const } : {}),
      rules: ownerRules(store),
      paused: turns.mode() === 'paused',
      backupFolder: backup?.folder() ?? defaultBackupFolder(options.agentDir),
      ...(backup?.lastAt() === undefined ? {} : { lastBackupAt: backup.lastAt()! }),
      ownership: ownership(),
      ...(backup?.phraseExportedAt() === undefined ? {} : { recoveryPhraseExportedAt: backup.phraseExportedAt()! }),
    }
  }

  const change = (next: SettingsChange): SettingsResult | Promise<SettingsResult> => {
    switch (next._tag) {
      case 'model': {
        if (next.provider === 'codex') return { _tag: 'refused', reason: 'unavailable', message: 'Codex is not available yet.' }
        if ((next.provider === 'custom') !== (picker.provider() === 'custom')) {
          return { _tag: 'refused', reason: 'invalid', message: 'That provider is not the one in use.' }
        }
        if (next.provider === 'custom') {
          const id = next.family.trim()
          if (id === '' || next.purpose !== 'chat') return { _tag: 'refused', reason: 'invalid', message: 'Enter a model id.' }
          save(store, { customModel: id })
          apply()
          break
        }
        const family = pickerFamilies.find((f) => f.label === next.family && f.path === next.purpose)
        const row = family === undefined ? undefined : rows().find((r: PickerModel) => r.choice.family === family.family && r.choice.provider === 'openrouter')
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
      case 'backupFolder': {
        if (backup === undefined) return { _tag: 'refused', reason: 'unavailable', message: 'Backup is not available on this Mac.' }
        if (!isAbsolute(next.path)) return { _tag: 'refused', reason: 'invalid', message: 'Choose a folder.' }
        // Answers once the first backup is in the new folder, or with why it is not.
        return backup.setFolder(next.path).then(
          (): SettingsResult => {
            changed()
            return { _tag: 'done' }
          },
          (error: unknown): SettingsResult => {
            options.onReport?.(error)
            changed()
            return { _tag: 'refused', ...backupFailure(error) }
          },
        )
      }
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
      closed = true
      clearInterval(timer)
      offTurns()
      offConnection()
      offOwnership()
    },
  }
}
