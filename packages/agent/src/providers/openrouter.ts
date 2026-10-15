import { createModels, type Api, type Model } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { DEFAULT_CHAT_FAMILY, DEFAULT_COMPACTION_FAMILY, piFamilyModel } from './catalog'
import { createProviderGuard, type GuardOptions, type ProviderGuardApi } from './guard'
import type { Store } from '../store/store'

/** The key comes from main (today from the environment; later its keychain) and stays in memory. */
export function createOpenRouter(options: Omit<GuardOptions, 'transport'> & {
  readonly models: readonly Model<Api>[]
  readonly apiKey: () => Promise<string | undefined>
}) {
  const provider = openrouterProvider()
  const transport = createModels()
  transport.setProvider({
    ...provider,
    getModels: () => options.models,
    getAllModels: () => options.models,
    auth: { apiKey: { name: 'OpenRouter', resolve: async () => {
      const key = await options.apiKey()
      if (!key) throw new Error('Missing OpenRouter key')
      return { auth: { apiKey: key } }
    } } },
  })
  return createProviderGuard({ ...options, transport })
}

/**
 * The turn engine's provider and models on OpenRouter, for the app: the
 * default chat and compaction families, resolved in pi-ai's catalogue. The
 * key is read on each request, so it may arrive after the engine opens; a
 * request without one fails, and the run ends `failed`.
 */
export function openRouterTurns(apiKey: () => Promise<string | undefined>): {
  readonly provider: (store: Store) => ProviderGuardApi
  readonly model: { readonly provider: string; readonly modelId: string }
  readonly compaction?: { readonly provider: string; readonly modelId: string }
} {
  const chat = piFamilyModel(DEFAULT_CHAT_FAMILY)
  if (chat === undefined) throw new Error(`pi-ai has no ${DEFAULT_CHAT_FAMILY} model`)
  const compaction = piFamilyModel(DEFAULT_COMPACTION_FAMILY)
  const models = compaction === undefined ? [chat] : [chat, compaction]
  return {
    provider: (store) => createOpenRouter({ store, models, apiKey }),
    model: { provider: chat.provider, modelId: chat.id },
    ...(compaction === undefined ? {} : { compaction: { provider: compaction.provider, modelId: compaction.id } }),
  }
}
