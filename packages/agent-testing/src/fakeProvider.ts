/**
 * A scripted model provider on pi-ai's faux provider, registered under the
 * provider id `openrouter` with the slugs the model picker resolves today
 * (docs/juno-agent/spikes.md), so runtime code addresses fake models exactly
 * as it addresses real ones. Each request takes the next scripted step.
 *
 * WP10 adds lost streams, usage reports and the deterministic compactor model.
 */
import { createModels, fauxProvider, type FauxModelDefinition, type FauxResponseStep, type Models } from '@earendil-works/pi-ai'

export const FAKE_PROVIDER = 'openrouter'

/** The chat families and the compaction default, with their real context windows. */
export const fakeCatalogue: ReadonlyArray<FauxModelDefinition> = [
  { id: 'anthropic/claude-sonnet-5.5', contextWindow: 1_000_000, maxTokens: 64_000 },
  { id: 'anthropic/claude-opus-5.5', contextWindow: 1_000_000, maxTokens: 64_000 },
  { id: 'meta/muse-wonder', contextWindow: 1_048_576, maxTokens: 64_000 },
  { id: 'openai/gpt-6.1-sol', contextWindow: 1_050_000, maxTokens: 64_000 },
  { id: 'x-ai/grok-4.7', contextWindow: 500_000, maxTokens: 64_000 },
  { id: 'anthropic/claude-haiku-5.5', contextWindow: 1_000_000, maxTokens: 64_000 },
]

export interface FakeProvider {
  readonly models: Models
  /** Replaces the script. */
  readonly script: (steps: ReadonlyArray<FauxResponseStep>) => void
  /** Requests made so far. */
  readonly calls: () => number
  /** Scripted steps not yet used. */
  readonly pending: () => number
}

export function fakeProvider(catalogue: ReadonlyArray<FauxModelDefinition> = fakeCatalogue): FakeProvider {
  const faux = fauxProvider({ provider: FAKE_PROVIDER, models: [...catalogue] })
  const models = createModels()
  models.setProvider(faux.provider)
  return {
    models,
    script: (steps) => faux.setResponses([...steps]),
    calls: () => faux.state.callCount,
    pending: () => faux.getPendingResponseCount(),
  }
}
