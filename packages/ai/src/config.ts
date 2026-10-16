import type { Effect } from 'effect'

/**
 * What the provider needs from the outside: the key, in memory, and the model
 * slug per tier. Both are preferences the owner can change; the defaults below
 * are the only place a slug is written.
 */
export type Tier = 'decision' | 'generation' | 'art'

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
  /** OpenRouter slug for topic art: a model that draws well in the SVG vocabulary (`docs/design/topic-art/v2`). */
  readonly art: string
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
  // The topic art study (docs/design/topic-art/v2, 2026-10-13): 35 of 35 valid drawings, median 2.3 s, about $0.006 per icon.
  art: 'google/gemini-3.8-flash',
}

/**
 * The answer to a spend reservation (the daily cap, plan v3 §5.4). `settle`
 * takes the reported cost in USD, or `undefined` when it is unknown, which
 * keeps the whole reservation for the day.
 */
export type Admission =
  | { readonly _tag: 'Admitted'; readonly settle: (actualUsd: number | undefined) => Effect.Effect<void> }
  | { readonly _tag: 'Blocked' }

export interface AiConfig {
  /** The OpenRouter key. Absent until the owner adds one; every call then returns no decision. */
  readonly apiKey?: string
  readonly models?: Partial<ModelPrefs>
  /** Reserves a call's upper cost in USD before it starts. Without it, calls are not counted against a cap. */
  readonly admit?: (upperUsd: number) => Effect.Effect<Admission>
}

export function modelFor(tier: Tier, config: AiConfig): string {
  return config.models?.[tier] ?? defaultModelPrefs[tier]
}

/** The decision model slug, or undefined when the preference turns decision models off. */
export function classifierFor(config: AiConfig): string | undefined {
  const slug = config.models?.classifier ?? defaultModelPrefs.classifier
  return slug === '' ? undefined : slug
}
