/**
 * What the provider needs from the outside: the key, in memory, and the model
 * slug per tier. Both are preferences the owner can change; the defaults below
 * are the only place a slug is written.
 */
export type Tier = 'decision' | 'generation'

export interface ModelPrefs {
  /**
   * OpenRouter slug of a System One decision model, for the decision tasks that
   * carry a classifier mapping (route check, settled, notification gate). An
   * empty string sends those tasks to the chat `decision` model instead.
   */
  readonly classifier: string
  /** OpenRouter slug for the decisions a chat model must make (grouping, command parsing): small, fast, tool calling. */
  readonly decision: string
  /** OpenRouter slug for generation: stronger, used sparingly. */
  readonly generation: string
}

/**
 * Measured with `pnpm --filter @juno/ai bench` on 2026-10-13 (the README has the
 * table). Jev 1.13 answered every mapped example right at about 0.5 s;
 * GPT-6 Luna was the most accurate small chat model on grouping and command
 * parsing; Sonnet 5.5 stays the generation model. Change them in preferences,
 * not here.
 */
export const defaultModelPrefs: ModelPrefs = {
  classifier: 'typesafe/jev-1.13',
  decision: 'openai/gpt-6-luna',
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

/** The decision model slug, or undefined when the preference turns decision models off. */
export function classifierFor(config: AiConfig): string | undefined {
  const slug = config.models?.classifier ?? defaultModelPrefs.classifier
  return slug === '' ? undefined : slug
}
