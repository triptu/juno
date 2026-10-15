/**
 * The auto-review's decision model (`review/review.ts`): TypeSafe's Jev on
 * OpenRouter, the same decision tier the app uses for its own judgements
 * (decision log 10-13), through pi-ai's `classify` with no retry. It needs
 * the owner's OpenRouter key; with another provider there is no review, and
 * every call that needs one asks.
 */
import { createModels, type ClassifierApi, type ClassifierModel } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import type { ReviewModel } from '../review/review'
import type { ProviderConnection } from './connection'

export const REVIEW_MODEL = 'typesafe/jev-1.13'
const OPENROUTER_ORIGIN = 'https://openrouter.ai'

/** `origin` replaces `https://openrouter.ai`, as the model picker's does (the fake OpenRouter in tests). */
export function reviewModel(connection: ProviderConnection, options: { readonly origin?: string } = {}): ReviewModel {
  const models = createModels()
  models.setProvider(openrouterProvider())
  const model: ClassifierModel<ClassifierApi> = {
    type: 'classifier', id: REVIEW_MODEL, name: REVIEW_MODEL, api: 'typesafe-system-one', provider: 'openrouter',
    baseUrl: `${options.origin ?? OPENROUTER_ORIGIN}/api/v1`, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000,
  }
  return async (request, signal) => {
    const provider = connection.current()
    if (provider?._tag !== 'openRouter') throw new Error('No OpenRouter key')
    const result = await models.classify(model, { state: request.state, questions: { ...request.questions } }, { apiKey: provider.key, signal, maxRetries: 0 })
    if (result.stopReason !== 'stop') throw new Error(result.errorMessage ?? result.stopReason)
    const answers = Object.fromEntries(Object.entries(result.answers).flatMap(([id, answer]) =>
      answer.type === 'choice' ? [[id, { choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities }]] : []))
    return { answers, ...(result.usage === undefined ? {} : { cost: result.usage.cost.total }) }
  }
}
