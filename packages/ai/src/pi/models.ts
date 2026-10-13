/**
 * The pi-ai `Models` collection with only the OpenRouter provider, and the
 * lookup from a slug to a model. A slug missing from pi-ai's catalogue still
 * works: it is sent as an OpenAI-compatible model with an unknown price.
 */
import { createModels, type Api, type ClassifierApi, type ClassifierModel, type Model, type Models } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'

export const OPENROUTER = 'openrouter'
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
/** OpenRouter serves every decision model through TypeSafe's System One protocol. */
const CLASSIFIER_API: ClassifierApi = 'typesafe-system-one'

/** The part of pi-ai's `Models` the provider uses. Tests pass a collection with a scripted provider. */
export type PiModels = Pick<Models, 'getModel' | 'getModelOfType' | 'complete' | 'stream' | 'classify'>

/**
 * The OpenRouter provider loads its chat API modules (the OpenAI and Anthropic
 * SDKs) on first use, which costs 0.2 s idle and seconds on a busy machine,
 * enough to miss a decision's budget. Start those imports now, in the
 * background, so the first decision does not pay for them.
 */
export function openRouterModels(): Models {
  const models = createModels()
  models.setProvider(openrouterProvider())
  void import('@earendil-works/pi-ai/api/openai-completions')
  void import('@earendil-works/pi-ai/api/anthropic-messages')
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

export interface ResolvedClassifier {
  readonly model: ClassifierModel<ClassifierApi>
  readonly priced: boolean
}

export function resolveClassifier(models: PiModels, slug: string): ResolvedClassifier {
  const known = models.getModelOfType('classifier', OPENROUTER, slug)
  if (known) return { model: known, priced: true }
  return {
    priced: false,
    model: {
      type: 'classifier',
      id: slug,
      name: slug,
      api: CLASSIFIER_API,
      provider: OPENROUTER,
      baseUrl: OPENROUTER_BASE_URL,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_000,
    },
  }
}
