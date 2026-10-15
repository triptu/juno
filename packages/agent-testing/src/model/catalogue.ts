/**
 * The fake models' catalogue, apart from the provider so the HTTP fake can
 * load it without pi-ai (Playwright loads tests as CommonJS, and pi-ai is
 * ESM only).
 */
import type { FauxModelDefinition } from '@earendil-works/pi-ai'

const price = (input: number, output: number) => ({ input, output, cacheRead: input / 10, cacheWrite: input * 1.25 })

/**
 * The chat families and both compaction models, with their real context
 * windows and input and output prices per million tokens (spikes.md). The
 * cache prices are invented: a tenth and 1.25 times the input price.
 */
export const fakeCatalogue: ReadonlyArray<FauxModelDefinition> = [
  { id: 'anthropic/claude-sonnet-5.5', contextWindow: 1_000_000, maxTokens: 64_000, cost: price(2, 10) },
  { id: 'anthropic/claude-opus-5.5', contextWindow: 1_000_000, maxTokens: 64_000, cost: price(4, 20) },
  { id: 'meta/muse-wonder', contextWindow: 1_048_576, maxTokens: 64_000, cost: price(4, 20) },
  { id: 'openai/gpt-6.1-sol', contextWindow: 1_050_000, maxTokens: 64_000, cost: price(2, 10) },
  { id: 'x-ai/grok-4.7', contextWindow: 500_000, maxTokens: 64_000, cost: price(2, 6) },
  { id: 'anthropic/claude-haiku-5.5', contextWindow: 1_000_000, maxTokens: 64_000, cost: price(0.1, 0.5) },
  { id: 'google/gemini-3.8-flash', contextWindow: 1_048_576, maxTokens: 64_000, cost: price(0.75, 3.75) },
]

/** The compaction default and its alternative (plan v3 §7.1). */
export const COMPACTION_MODELS: ReadonlyArray<string> = ['anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash']
