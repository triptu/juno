import { afterEach, expect, it } from 'bun:test'
import { fakeProvider } from '@juno/agent-testing'
import { createCatalogue, resolveCatalogue, resolveCodexModels } from '../src/index'
import { providerHarness } from './providers-harness'

const row = (id: string, created = 10, context_length = 1_000_000) => ({
  id, created, context_length, supported_parameters: ['tools'], architecture: { output_modalities: ['text'] },
  pricing: { prompt: '0.000002', completion: '0.00001' },
})
const fixture = { data: [
  row('anthropic/claude-sonnet-5'), row('anthropic/claude-sonnet-5.5', 20),
  row('anthropic/claude-opus-5.5'), row('meta/muse-wonder', 20), row('meta/muse-spark-1.3'),
  row('openai/gpt-6.1-sol'), row('x-ai/grok-4.7'),
  { ...row('anthropic/claude-haiku-5.5', 10, 131_072), pricing: { prompt: '0.0000001', completion: '0.0000005' } }, row('google/gemini-3.8-flash', 10, 131_072),
  row('anthropic/claude-haiku-6', 100, 131_071), row('x-ai/grok-build-0.1', 100),
  row('~openai/gpt-9-sol-latest', 100), row('openai/gpt-9-sol:batch', 100),
  ...['pro', 'contributor', 'lite', 'preview', 'image'].map(suffix => row(`meta/muse-${suffix}`, 100)),
  { ...row('x-ai/grok-8', 100), supported_parameters: [] },
  { ...row('x-ai/grok-9', 100), architecture: { output_modalities: ['text', 'image'] } },
  { ...row('openai/gpt-9-sol', 100), pricing: { prompt: '-1', completion: '0' } },
  row('anthropic/claude-sonnet-7', 100, 200_000),
] }
let h: Awaited<ReturnType<typeof providerHarness>> | undefined
afterEach(async () => { await h?.close(); h = undefined })

it('resolves each family from a fixed catalogue, joins pi data, uses the compaction minimum and limits Codex to its listing', () => {
  const fake = fakeProvider()
  const rows = resolveCatalogue(fixture, { systemAndTools: ['system', '[]'], piModels: fake.models.getModels() })
  expect(rows.map(r => r.model.id)).toEqual([
    'anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5', 'meta/muse-wonder', 'openai/gpt-6.1-sol', 'x-ai/grok-4.7',
    'anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash',
  ])
  expect(rows[0]!.model.api).toBe(fake.model('anthropic/claude-sonnet-5.5').api)
  expect(rows.map(r => r.path)).toEqual(['chat', 'chat', 'chat', 'chat', 'chat', 'compaction', 'compaction'])
  expect(rows[0]!.price).toEqual({ input: 2, output: 10 })
  expect(rows[5]!.price).toEqual({ input: 0.1, output: 0.5 })
  const next = resolveCatalogue({ data: [row('anthropic/claude-sonnet-8', 500)] }, { systemAndTools: [], piModels: [] })[0]!
  expect(next.model).toMatchObject({ api: 'openai-completions', cost: { input: 2, output: 10 }, contextWindow: 1_000_000 })
  expect(next.choice).toEqual({ family: 'sonnet', provider: 'openrouter' })
  expect(resolveCatalogue(fixture, { systemAndTools: ['x'.repeat(2_000_000)] })).toEqual([])
  // Codex offers only what its listing names, and falls back to the catalogue's Sol when it lists nothing.
  const sol = resolveCodexModels(undefined, { systemAndTools: [] })
  expect(sol).toMatchObject({ choice: { family: 'sol', provider: 'codex' } })
  expect(sol!.model.contextWindow).toBeGreaterThanOrEqual(250_000)
  expect(resolveCodexModels([], { systemAndTools: [] })).toBeUndefined()
  expect(resolveCodexModels([sol!.model.id], { systemAndTools: [] })?.model.id).toBe(sol!.model.id)
})

it('pins the catalogue for a day, persists it, reports changes and falls back offline', async () => {
  h = await providerHarness()
  let calls = 0
  const catalogueFetch: typeof fetch = async () => { calls++; return Response.json(fixture) }
  const catalogue = createCatalogue(h.core.store, { systemAndTools: [], fetch: catalogueFetch })
  await Promise.all([catalogue.refresh(), catalogue.refresh()])
  expect(calls).toBe(1)
  const local = catalogue.codex(undefined).row
  expect(local?.choice.provider).toBe('codex')
  expect(catalogue.codex([]).row?.model.id).toBe(local?.model.id)
  await h.reopen()
  await createCatalogue(h.core.store, { systemAndTools: [], fetch: catalogueFetch }).refresh()
  expect(calls).toBe(1)
  h.nextDay()
  const next = await createCatalogue(h.core.store, { systemAndTools: [], fetch: async () => Response.json({ data: [...fixture.data, row('anthropic/claude-sonnet-6', 100)] }) }).refresh()
  expect(next.changes).toContainEqual({ family: 'sonnet', previous: 'anthropic/claude-sonnet-5.5', current: 'anthropic/claude-sonnet-6' })
  h.nextDay()
  const cached = await createCatalogue(h.core.store, { systemAndTools: [], fetch: async () => { throw new Error('offline') } }).refresh()
  expect(cached.stale).toBe(true)
  expect(cached.rows[0]!.model.id).toBe('anthropic/claude-sonnet-6')
})

it("takes what a model reads from OpenRouter's input modalities, over pi-ai's entry", () => {
  const fake = fakeProvider()
  const reads = (input_modalities?: ReadonlyArray<string>) =>
    resolveCatalogue({ data: [{ ...row('anthropic/claude-sonnet-5.5', 20), architecture: { output_modalities: ['text'], ...(input_modalities ? { input_modalities } : {}) } }] }, { systemAndTools: [], piModels: fake.models.getModels() })[0]!.model.input
  expect(reads(['text', 'image', 'file'])).toEqual(['text', 'image'])
  expect(reads(['text'])).toEqual(['text'])
  // Without OpenRouter's word, pi-ai's entry decides.
  expect(reads()).toEqual(fake.model('anthropic/claude-sonnet-5.5').input)
})
