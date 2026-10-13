/**
 * The pi-ai `Models` collection with only the OpenRouter provider, and the
 * lookup from a slug to a model. A slug missing from pi-ai's catalogue still
 * works: it is sent as an OpenAI-compatible model with an unknown price.
 */
import { createModels, type Api, type Model, type Models } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'

export const OPENROUTER = 'openrouter'
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/** The part of pi-ai's `Models` the provider uses. Tests pass a collection with pi-ai's faux provider. */
export type PiModels = Pick<Models, 'getModel' | 'complete' | 'stream'>

export function openRouterModels(): Models {
  const models = createModels()
  models.setProvider(openrouterProvider())
  return models
}

export interface ResolvedModel {
  readonly model: Model<Api>
  /** False when the slug is not in pi-ai's price table, so the cost is unknown. */
  readonly priced: boolean
}

export function resolveModel(models: PiModels, slug: string): ResolvedModel {
  const known = models.getModel(OPENROUTER, slug)
  if (known) return { model: known, priced: true }
  return {
    priced: false,
    model: {
      id: slug,
      name: slug,
      api: 'openai-completions',
      provider: OPENROUTER,
      baseUrl: OPENROUTER_BASE_URL,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: false,
      contextWindow: 128_000,
      maxTokens: 8192,
    },
  }
}
