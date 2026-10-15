import { Schema } from 'effect'
import { requiredWindow, limits } from '@juno/agent-memory'
import { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models'
import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models'
import type { Api, Model } from '@earendil-works/pi-ai'
import { spendDay } from '../spend'
import { transaction } from '../store/database'
import type { Store } from '../store/store'

const CatalogueEntry = Schema.Struct({
  id: Schema.String, name: Schema.optionalKey(Schema.String), created: Schema.Number,
  context_length: Schema.Number,
  supported_parameters: Schema.Array(Schema.String),
  architecture: Schema.optionalKey(Schema.Struct({ output_modalities: Schema.optionalKey(Schema.Array(Schema.String)) })),
  top_provider: Schema.optionalKey(Schema.Struct({ max_completion_tokens: Schema.optionalKey(Schema.NullOr(Schema.Number)) })),
  pricing: Schema.Struct({ prompt: Schema.String, completion: Schema.String,
    input_cache_read: Schema.optionalKey(Schema.String), input_cache_write: Schema.optionalKey(Schema.String) }),
})
const Catalogue = Schema.Struct({ data: Schema.Array(Schema.Unknown) })
const decodeEntry = Schema.decodeUnknownOption(CatalogueEntry)
export const COMPACTION_MIN_WINDOW = 131_072
export const DEFAULT_CHAT_FAMILY = 'sonnet'
export const DEFAULT_COMPACTION_FAMILY = 'haiku'
const families = [
  { family: 'sonnet', label: 'Claude Sonnet', pattern: /^anthropic\/claude-sonnet-\d+(?:\.\d+)*$/, path: 'chat' },
  { family: 'opus', label: 'Claude Opus', pattern: /^anthropic\/claude-opus-\d+(?:\.\d+)*$/, path: 'chat' },
  { family: 'muse', label: 'Muse', pattern: /^meta\/muse-[a-z]+(?:-\d+(?:\.\d+)*)?$/, path: 'chat' },
  { family: 'sol', label: 'GPT Sol', pattern: /^openai\/gpt-\d+(?:\.\d+)*-sol$/, path: 'chat' },
  { family: 'grok', label: 'Grok', pattern: /^x-ai\/grok-\d+(?:\.\d+)*$/, path: 'chat' },
  { family: 'haiku', label: 'Claude Haiku', pattern: /^anthropic\/claude-haiku-\d+(?:\.\d+)*$/, path: 'compaction' },
  { family: 'flash', label: 'Gemini Flash', pattern: /^google\/gemini-\d+(?:\.\d+)*-flash$/, path: 'compaction' },
] as const
export type ModelFamily = typeof families[number]['family']
export type ModelChoice = { readonly family: ModelFamily; readonly provider: 'openrouter' } | { readonly family: 'sol'; readonly provider: 'codex' }
export interface PickerModel {
  readonly choice: ModelChoice
  readonly label: string
  readonly path: 'chat' | 'compaction'
  readonly model: Model<Api>
  /** Dollars per million tokens, for the row's price hint. None for Codex: its turns are counted, not charged. */
  readonly price: { readonly input: number; readonly output: number } | undefined
}
export interface CatalogueOptions {
  readonly systemAndTools: readonly string[]
  readonly multiplier?: 1 | 1.25
  readonly piModels?: readonly Model<Api>[]
}
/** OpenRouter prices are dollars per token, as decimal text. Round away float noise: 0.0000001 is $0.10 per million. */
const rate = (text: string): number | undefined => {
  if (text.trim() === '') return undefined
  const n = Math.round(Number(text) * 1e12) / 1e6
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Invalid or unpriced entries are never offered. No model slugs are hard-coded. */
export function resolveCatalogue(body: unknown, options: CatalogueOptions): readonly PickerModel[] {
  const entries = Schema.decodeUnknownSync(Catalogue)(body).data.flatMap(raw => {
    const parsed = decodeEntry(raw)
    return parsed._tag === 'Some' ? [parsed.value] : []
  }).filter(m => m.supported_parameters.includes('tools') && !m.id.includes(':') && !m.id.includes('~') &&
    !/-(pro|contributor|lite|preview|image)(?:$|-)/.test(m.id) &&
    (m.architecture?.output_modalities ?? ['text']).every(x => x === 'text') &&
    Number.isSafeInteger(m.context_length) && m.context_length > 0 && Number.isFinite(m.created) &&
    rate(m.pricing.prompt) !== undefined && rate(m.pricing.completion) !== undefined)
  const pi = options.piModels ?? Object.values(OPENROUTER_MODELS)
  return families.flatMap(family => {
    const minimum = Math.max(family.path === 'compaction' ? COMPACTION_MIN_WINDOW : 0,
      requiredWindow(options.systemAndTools, family.path, options.multiplier))
    const picked = entries.filter(m => family.pattern.test(m.id) && m.context_length >= minimum &&
      (m.top_provider?.max_completion_tokens == null || m.top_provider.max_completion_tokens >= limits.reserve))
      .toSorted((a, b) => b.created - a.created || a.id.localeCompare(b.id))[0]
    if (!picked) return []
    const known = pi.find(m => m.id === picked.id)
    const input = rate(picked.pricing.prompt)!
    const output = rate(picked.pricing.completion)!
    const model: Model<Api> = {
      ...(known ?? { api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', reasoning: false, input: ['text'] }),
      provider: 'openrouter', id: picked.id, name: picked.name ?? picked.id,
      contextWindow: picked.context_length, maxTokens: picked.top_provider?.max_completion_tokens ?? known?.maxTokens ?? limits.reserve,
      cost: {
        input, output,
        cacheRead: picked.pricing.input_cache_read === undefined ? known?.cost.cacheRead ?? input : rate(picked.pricing.input_cache_read) ?? input,
        cacheWrite: picked.pricing.input_cache_write === undefined ? Math.max(known?.cost.cacheWrite ?? 0, input * 1.25) : rate(picked.pricing.input_cache_write) ?? input * 1.25,
        ...(known?.cost.tiers ? { tiers: known.cost.tiers } : {}),
      },
    }
    return [{ choice: { family: family.family, provider: 'openrouter' }, label: family.label, path: family.path,
      model, price: { input, output } } satisfies PickerModel]
  })
}

/**
 * The newest model of `family` in pi-ai's own OpenRouter catalogue, for a
 * start before OpenRouter's live catalogue has been read (no network). The
 * same family patterns as the picker, so no slug is hard-coded.
 */
export function piFamilyModel(family: ModelFamily, piModels: readonly Model<Api>[] = Object.values(OPENROUTER_MODELS)): Model<Api> | undefined {
  const pattern = families.find(f => f.family === family)!.pattern
  return piModels.filter(m => pattern.test(m.id)).toSorted((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))[0]
}

/** app-server lists availability; pi supplies the windows it does not report. */
export function resolveCodexModels(ids: readonly string[] | undefined, options: Pick<CatalogueOptions, 'systemAndTools' | 'multiplier'>): PickerModel | undefined {
  const candidates = Object.values(OPENAI_CODEX_MODELS).filter(m => /^gpt-\d+(?:\.\d+)*-sol$/.test(m.id) &&
    (ids === undefined || ids.includes(m.id)) && m.contextWindow >= requiredWindow(options.systemAndTools, 'chat', options.multiplier))
  const model = candidates.toSorted((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))[0]
  return model ? { choice: { family: 'sol', provider: 'codex' }, label: 'GPT Sol', path: 'chat', model, price: undefined } : undefined
}

export interface ModelChange { readonly family: string; readonly previous: string; readonly current: string }
/** Call at startup and daily. Concurrent callers share one refresh; offline uses the last cache. */
export function createCatalogue(store: Store, options: CatalogueOptions & { readonly fetch?: typeof fetch }) {
  let refresh: Promise<{ readonly rows: readonly PickerModel[]; readonly changes: readonly ModelChange[]; readonly stale: boolean }> | undefined
  const resolve = (body: unknown) => resolveCatalogue(body, { ...options, multiplier:
    store.db.prepare("SELECT 1 FROM provider_bounds WHERE provider = 'openrouter'").get() ? 1.25 : options.multiplier })
  const load = async () => {
    const day = spendDay(store.now())
    const cached = store.db.prepare('SELECT day, body FROM model_catalogue WHERE singleton = 1').get()
    if (cached?.day === day) return { rows: resolve(JSON.parse(String(cached.body))), changes: [], stale: false }
    let body: unknown
    try {
      const response = await (options.fetch ?? fetch)('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`Catalogue request failed (${response.status})`)
      body = await response.json()
      const rows = resolve(body)
      if (rows.length === 0) throw new Error('No compatible models in catalogue')
      const changes = transaction(store.db, () => {
        const changed: ModelChange[] = []
        for (const row of rows) {
          const previous = store.db.prepare('SELECT slug FROM model_resolution WHERE family = ? AND provider = ? ORDER BY day DESC LIMIT 1').get(row.choice.family, row.choice.provider)
          if (previous && previous.slug !== row.model.id) changed.push({ family: row.choice.family, previous: String(previous.slug), current: row.model.id })
          store.db.prepare('INSERT OR REPLACE INTO model_resolution(day, family, provider, slug) VALUES (?, ?, ?, ?)').run(day, row.choice.family, row.choice.provider, row.model.id)
        }
        store.db.prepare('INSERT OR REPLACE INTO model_catalogue(singleton, day, body) VALUES (1, ?, ?)').run(day, JSON.stringify(body))
        return changed
      })
      return { rows, changes, stale: false }
    } catch (error) {
      if (!cached) throw error
      return { rows: resolve(JSON.parse(String(cached.body))), changes: [], stale: true }
    }
  }
  return {
    refresh: () => refresh ??= load().finally(() => { refresh = undefined }),
    /** Pin the local Sol choice for the day too. Listing failure uses pi's catalogue. */
    codex: (ids: readonly string[] | undefined): { readonly row: PickerModel | undefined; readonly changes: readonly ModelChange[] } => {
      const day = spendDay(store.now())
      const saved = store.db.prepare("SELECT slug FROM model_resolution WHERE day = ? AND family = 'sol' AND provider = 'codex'").get(day)
      const row = resolveCodexModels(saved ? [String(saved.slug)] : ids, options)
      if (!row || saved) return { row, changes: [] }
      return transaction(store.db, () => {
        const previous = store.db.prepare("SELECT slug FROM model_resolution WHERE family = 'sol' AND provider = 'codex' ORDER BY day DESC LIMIT 1").get()
        store.db.prepare("INSERT INTO model_resolution(day, family, provider, slug) VALUES (?, 'sol', 'codex', ?)").run(day, row.model.id)
        return { row, changes: previous && previous.slug !== row.model.id
          ? [{ family: 'sol', previous: String(previous.slug), current: row.model.id }] : [] }
      })
    },
  }
}
