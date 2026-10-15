import { createModels, type Api, type Model } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { JUNO_INSTRUCTIONS } from '../request/prompt'
import { capOf, modelFor } from '../settings/store'
import { createSpend } from '../spend'
import type { Store } from '../store/store'
import { createCatalogue, piRows, type PickerModel } from './catalog'
import { createProviderGuard, type GuardOptions, type ProviderGuardApi } from './guard'

/** The key comes from main (the keychain, or the environment in development) and stays in memory. */
export function createOpenRouter(options: Omit<GuardOptions, 'transport'> & {
  /** Read on every request, so the list can change after a catalogue refresh. */
  readonly models: () => readonly Model<Api>[]
  readonly apiKey: () => Promise<string | undefined>
}) {
  const provider = openrouterProvider()
  const transport = createModels()
  transport.setProvider({
    ...provider,
    getModels: () => options.models(),
    getAllModels: () => options.models(),
    auth: { apiKey: { name: 'OpenRouter', resolve: async () => {
      const key = await options.apiKey()
      if (!key) throw new Error('Missing OpenRouter key')
      return { auth: { apiKey: key } }
    } } },
  })
  return createProviderGuard({ ...options, transport })
}

/**
 * The OpenRouter key as the agent holds it: in memory, from main. `get`
 * waits until main has said whether there is one, so a first request does
 * not race the message. `rejected` marks the current key after OpenRouter
 * refused it; a new key clears the mark.
 */
export interface OpenRouterKey {
  readonly get: () => Promise<string | undefined>
  readonly set: (key: string | null) => void
  readonly rejected: () => void
  readonly status: () => 'missing' | 'set' | 'rejected'
  readonly subscribe: (listener: () => void) => () => void
}

export function openRouterKey(): OpenRouterKey {
  let key: string | null | undefined
  let rejected = false
  const waiters: Array<(key: string | undefined) => void> = []
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  return {
    get: () =>
      new Promise((resolve) => {
        if (key !== undefined) resolve(key ?? undefined)
        else waiters.push(resolve)
      }),
    set: (next) => {
      key = next
      rejected = false
      for (const resolve of waiters.splice(0)) resolve(next ?? undefined)
      changed()
    },
    rejected: () => {
      if (rejected || !key) return
      rejected = true
      changed()
    },
    status: () => (!key ? 'missing' : rejected ? 'rejected' : 'set'),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * The model picker's rows (plan v3 §7.1): OpenRouter's catalogue once it
 * has been read today, else the last cached one, else pi-ai's own
 * catalogue. The provider serves every row's model, so a change of choice
 * needs no new provider.
 */
export interface ModelPicker {
  readonly rows: () => readonly PickerModel[]
  readonly models: () => readonly Model<Api>[]
  /** Reads the catalogue, once a day; offline keeps the last. Call once the store is open. Resolves true when the rows changed. */
  readonly refresh: (store: Store) => Promise<boolean>
}

export interface PickerOptions {
  readonly fetch?: typeof fetch
  /**
   * Another origin for OpenRouter, for the catalogue and every model's base
   * URL. Only the e2e tests set it, to reach the fake.
   */
  readonly origin?: string
}

const OPENROUTER_ORIGIN = 'https://openrouter.ai'
const ref = (row: PickerModel | undefined) => (row === undefined ? undefined : { provider: row.model.provider, modelId: row.model.id })

export function modelPicker(options: PickerOptions = {}): ModelPicker {
  const rebase = (row: PickerModel): PickerModel =>
    options.origin === undefined || !row.model.baseUrl.startsWith(OPENROUTER_ORIGIN)
      ? row
      : { ...row, model: { ...row.model, baseUrl: options.origin + row.model.baseUrl.slice(OPENROUTER_ORIGIN.length) } }
  let rows = piRows().map(rebase)
  let catalogue: ReturnType<typeof createCatalogue> | undefined
  return {
    rows: () => rows,
    models: () => rows.map((row) => row.model),
    refresh: async (store) => {
      catalogue ??= createCatalogue(store, {
        systemAndTools: [JUNO_INSTRUCTIONS],
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.origin ? { url: `${options.origin}/api/v1/models` } : {}),
      })
      const next = (await catalogue.refresh()).rows.map(rebase)
      const changed = JSON.stringify(next.map((row) => [row.choice, row.model.id, row.price])) !== JSON.stringify(rows.map((row) => [row.choice, row.model.id, row.price]))
      rows = next
      return changed
    },
  }
}

/**
 * The turn engine's provider and models on OpenRouter, for the app. The
 * models are the owner's saved families (Settings › Juno), resolved in the
 * picker's rows; before the catalogue is read that is pi-ai's newest Sonnet
 * and Haiku. The key is read on each request, so it may arrive after the
 * engine opens; a request without one fails, and the run ends `failed`.
 * The daily cap is the saved one.
 */
export function openRouterTurns(key: OpenRouterKey, picker: ModelPicker = modelPicker()): {
  readonly provider: (store: Store) => ProviderGuardApi
  readonly model: (store: Store) => { readonly provider: string; readonly modelId: string }
  readonly compaction: (store: Store) => { readonly provider: string; readonly modelId: string } | undefined
  readonly picker: ModelPicker
  readonly key: OpenRouterKey
} {
  return {
    provider: (store) => createOpenRouter({ store, models: picker.models, apiKey: key.get, spend: createSpend(store, () => capOf(store)) }),
    model: (store) => {
      const chat = ref(modelFor(store, picker.rows(), 'chat'))
      if (chat === undefined) throw new Error('pi-ai has no chat model')
      return chat
    },
    compaction: (store) => ref(modelFor(store, picker.rows(), 'compaction')),
    picker,
    key,
  }
}
