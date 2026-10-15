/**
 * One OpenAI-compatible endpoint (SPEC 13.10): a local model server (Ollama,
 * LM Studio, vLLM) or any service that speaks chat completions. pi-ai's
 * `openai-completions` API talks to it, with the plainest request shape such
 * servers accept.
 *
 * Its models come from `GET <baseUrl>/models` when the endpoint answers;
 * otherwise the owner types a model id. Neither lists a context window or
 * prices as a rule: a reported window (`context_length`, vLLM's
 * `max_model_len`) is used, else `CUSTOM_WINDOW`; OpenRouter-style
 * `pricing` is used when present, else the model costs $0 and the cap
 * cannot track it.
 */
import { Schema } from 'effect'
import { limits } from '@juno/agent-memory'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { PickerModel } from './catalog'

export const CUSTOM_PROVIDER = 'custom'
/** The window assumed for a model that reports none. A request over the real one fails at the endpoint. */
export const CUSTOM_WINDOW = 262_144

const Listing = Schema.Struct({ data: Schema.Array(Schema.Unknown) })
const Entry = Schema.Struct({
  id: Schema.String,
  context_length: Schema.optionalKey(Schema.Number),
  max_model_len: Schema.optionalKey(Schema.Number),
  pricing: Schema.optionalKey(Schema.Struct({ prompt: Schema.String, completion: Schema.String })),
})
const decodeEntry = Schema.decodeUnknownOption(Entry)

/** Dollars per token as text, to dollars per million. */
const perMillion = (text: string) => {
  const n = Math.round(Number(text) * 1e12) / 1e6
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export interface CustomModelInfo {
  readonly contextWindow?: number
  readonly price?: { readonly input: number; readonly output: number }
}

export function customRow(baseUrl: string, id: string, info: CustomModelInfo = {}): PickerModel {
  const input = info.price?.input ?? 0
  const model: Model<Api> = {
    id, name: id, api: 'openai-completions', provider: CUSTOM_PROVIDER, baseUrl: baseUrl.replace(/\/+$/, ''),
    reasoning: false, input: ['text'],
    cost: { input, output: info.price?.output ?? 0, cacheRead: input, cacheWrite: input },
    contextWindow: info.contextWindow ?? CUSTOM_WINDOW,
    maxTokens: limits.reserve,
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens', supportsStrictMode: false },
  } as Model<Api>
  return { choice: { family: id, provider: 'custom' }, label: id, path: 'chat', model, price: info.price }
}

/** The endpoint's models, or undefined when it does not list them. */
export async function listCustomModels(
  endpoint: { readonly baseUrl: string; readonly key: string | null },
  fetcher: typeof fetch = fetch,
): Promise<readonly PickerModel[] | undefined> {
  try {
    const response = await fetcher(`${endpoint.baseUrl.replace(/\/+$/, '')}/models`, {
      signal: AbortSignal.timeout(10_000),
      ...(endpoint.key ? { headers: { authorization: `Bearer ${endpoint.key}` } } : {}),
    })
    if (!response.ok) return undefined
    const listed = Schema.decodeUnknownSync(Listing)(await response.json()).data.flatMap((raw) => {
      const entry = decodeEntry(raw)
      return entry._tag === 'Some' ? [entry.value] : []
    })
    if (listed.length === 0) return undefined
    return listed.map((entry) => {
      const window = entry.context_length ?? entry.max_model_len
      const input = entry.pricing === undefined ? undefined : perMillion(entry.pricing.prompt)
      const output = entry.pricing === undefined ? undefined : perMillion(entry.pricing.completion)
      return customRow(endpoint.baseUrl, entry.id, {
        ...(window !== undefined && Number.isSafeInteger(window) && window > 0 ? { contextWindow: window } : {}),
        ...(input !== undefined && output !== undefined ? { price: { input, output } } : {}),
      })
    })
  } catch {
    return undefined
  }
}
