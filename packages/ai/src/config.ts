/**
 * What the provider needs from the outside: the key, in memory, and the model
 * slug per tier. Both are preferences the owner can change; the defaults below
 * are the only place a slug is written.
 */
export type Tier = 'decision' | 'generation'

export interface ModelPrefs {
  /** OpenRouter slug for decisions: small, fast, cheap, tool calling. */
  readonly decision: string
  /** OpenRouter slug for generation: stronger, used sparingly. */
  readonly generation: string
}

/**
 * Checked against OpenRouter's public model list on 2026-10-13. Haiku 5.5 is the
 * cheapest current model with tool calling (0.10 / 0.50 USD per million tokens)
 * and Sonnet 5.5 the mid-price generation model (2 / 10 USD). Change them in
 * preferences, not here.
 */
export const defaultModelPrefs: ModelPrefs = {
  decision: 'anthropic/claude-haiku-5.5',
  generation: 'anthropic/claude-sonnet-5.5',
}

export interface AiConfig {
  /** The OpenRouter key. Absent until the owner adds one; every call then returns no decision. */
  readonly apiKey?: string
  readonly models?: Partial<ModelPrefs>
}

export function modelFor(tier: Tier, config: AiConfig): string {
  return config.models?.[tier] ?? defaultModelPrefs[tier]
}
