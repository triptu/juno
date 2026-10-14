import { createModels, type Api, type Model } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { createProviderGuard, type GuardOptions } from './guard'

/** The key comes from main's keychain bridge and stays in memory. */
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
