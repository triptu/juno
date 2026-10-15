/**
 * The app's model providers (SPEC 13.10): OpenRouter, or one
 * OpenAI-compatible endpoint, whichever main says is active. Both sit
 * behind the same provider guard and spend ledger, so admission, the
 * untrusted-content rules and the daily cap hold whatever the provider.
 */
import { createModels, createProvider, type Api, type Model } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { capOf, modelFor, servedModels } from '../settings/store'
import { createSpend } from '../spend'
import type { Store } from '../store/store'
import type { PickerModel } from './catalog'
import type { ProviderConnection } from './connection'
import { CUSTOM_PROVIDER } from './custom'
import { createProviderGuard, type ProviderGuardApi } from './guard'
import { modelPicker, type ModelPicker } from './picker'

/**
 * Sent when a custom endpoint has no key: OpenAI-compatible clients need
 * one, and local servers ignore it.
 */
const NO_KEY = 'none'

/** A transport with both providers. Their model lists are read on every refresh of the guard. */
export function createProviderTransport(connection: ProviderConnection, models: () => readonly Model<Api>[]) {
  const transport = createModels()
  const of = (provider: string) => () => models().filter((model) => model.provider === provider)
  const openRouter = openrouterProvider()
  transport.setProvider({
    ...openRouter,
    getModels: of('openrouter'),
    getAllModels: of('openrouter'),
    auth: { apiKey: { name: 'OpenRouter', resolve: async () => {
      const provider = await connection.get()
      if (provider?._tag !== 'openRouter') throw new Error('Missing OpenRouter key')
      return { auth: { apiKey: provider.key } }
    } } },
  })
  const custom = createProvider({
    id: CUSTOM_PROVIDER,
    name: 'OpenAI-compatible',
    auth: { apiKey: { name: 'OpenAI-compatible endpoint', resolve: async () => {
      const provider = await connection.get()
      if (provider?._tag !== 'custom') throw new Error('Missing OpenAI-compatible endpoint')
      return { auth: { apiKey: provider.key ?? NO_KEY } }
    } } },
    models: [],
    api: openAICompletionsApi(),
  })
  transport.setProvider({ ...custom, getModels: of(CUSTOM_PROVIDER), getAllModels: of(CUSTOM_PROVIDER) })
  return transport
}

/** No model chosen yet on a custom endpoint that lists none: a run fails until the owner types one. */
const NO_MODEL = { provider: CUSTOM_PROVIDER, modelId: '' }
const ref = (row: PickerModel | undefined) => (row === undefined ? undefined : { provider: row.model.provider, modelId: row.model.id })

/**
 * The turn engine's provider and models for the app. The models are the
 * owner's saved choice (Settings › Juno) in the active provider's rows;
 * before OpenRouter's catalogue is read that is pi-ai's newest Sonnet and
 * Haiku. Keys are read on each request. The daily cap is the saved one.
 */
export function providerTurns(connection: ProviderConnection, picker: ModelPicker = modelPicker(connection)): {
  readonly provider: (store: Store) => ProviderGuardApi
  readonly model: (store: Store) => { readonly provider: string; readonly modelId: string }
  readonly compaction: (store: Store) => { readonly provider: string; readonly modelId: string } | undefined
  readonly picker: ModelPicker
  readonly connection: ProviderConnection
} {
  return {
    provider: (store) =>
      createProviderGuard({ store, transport: createProviderTransport(connection, () => servedModels(store, picker)), spend: createSpend(store, () => capOf(store)), ...(picker.codex ? { codex: picker.codex } : {}) }),
    model: (store) => ref(modelFor(store, picker, 'chat')) ?? NO_MODEL,
    compaction: (store) => ref(modelFor(store, picker, 'compaction')),
    picker,
    connection,
  }
}
