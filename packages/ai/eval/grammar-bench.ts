#!/usr/bin/env node
import { Effect } from 'effect'
import { grammarCheck, makeFakeAiProvider, makePiAiProvider, openRouterModels, type GrammarEdit } from '../src/index'
import { grammarCases } from './grammar-cases'

const candidates = [
  'openai/gpt-6-luna', 'anthropic/claude-haiku-5.5',
  'google/gemini-3.8-flash', 'google/gemini-3.7-flash', 'google/gemini-3.5-flash-lite',
  'google/gemini-3.1-flash-lite', 'openai/gpt-4.1-nano',
]
const apply = (text: string, edits: ReadonlyArray<GrammarEdit>) => edits.toReversed().reduce((value, edit) => value.slice(0, edit.start) + edit.to + value.slice(edit.start + edit.from.length), text)
const percentile = (values: number[], p: number) => values.toSorted((a, b) => a - b)[Math.ceil(values.length * p) - 1]
const ratio = (n: number, d: number) => d === 0 ? '—' : `${(100 * n / d).toFixed(1)}%`

async function main() {
  const fake = process.argv.includes('--fake')
  // Same source as createSupervisor: the process environment, never a stored chat key.
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!fake && !apiKey) {
    console.log('Not run: the engine environment has no OPENROUTER_API_KEY. No default selected.')
    process.exitCode = 2
    return
  }
  const models = openRouterModels()
  const names = fake ? ['fake'] : candidates
  const providers = names.map((model) => ({
    model,
    provider: fake ? makeFakeAiProvider() : makePiAiProvider(Effect.succeed({ apiKey, models: { classifier: '', decision: model } }), models),
    times: [] as number[], tp: 0, fp: 0, fn: 0, errors: 0, cost: 0,
  }))
  // Measure the whole answer, not a first token. A longer measurement deadline exposes misses.
  const task = { ...grammarCheck, timeoutMillis: 10_000 }
  const reps = fake ? 1 : 5
  for (const row of providers) await Effect.runPromise(row.provider.decide(task, { draft: 'sounds good' }))
  // Rotate order each round; one request at a time avoids benchmarking client concurrency.
  for (let rep = 0; rep < reps; rep++) {
    for (const sample of grammarCases) {
      for (let i = 0; i < providers.length; i++) {
        const row = providers[(i + rep) % providers.length]!
        const start = performance.now()
        const answer = await Effect.runPromise(row.provider.decide(task, { draft: sample.draft }))
        const elapsed = performance.now() - start
        row.cost += answer.meta.costUsd ?? 0
        const issue = sample.draft !== sample.expected
        if (answer._tag === 'NoDecision') {
          row.errors++
          if (issue) row.fn++
          continue
        }
        row.times.push(elapsed)
        const fixed = apply(sample.draft, answer.value.edits)
        if (fixed !== sample.draft) {
          if (issue && fixed === sample.expected) row.tp++
          else row.fp++
        }
        if (issue && fixed !== sample.expected) row.fn++
      }
    }
  }
  console.log(`Mode: ${fake ? 'fake, validates fixtures only; no model quality or latency claim' : 'live OpenRouter'}. ${grammarCases.length} cases, ${reps} rounds, one unscored warmup per model.`)
  console.log('| Model | Answers | Errors | p50 ms | p95 ms | Precision | Recall | Cost USD |')
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const row of providers) console.log(`| ${row.model} | ${row.times.length} | ${row.errors} | ${percentile(row.times, .5)?.toFixed(0) ?? '—'} | ${percentile(row.times, .95)?.toFixed(0) ?? '—'} | ${ratio(row.tp, row.tp + row.fp)} | ${ratio(row.tp, row.tp + row.fn)} | ${row.cost.toFixed(5)} |`)
  const eligible = providers.filter((row) => row.errors === 0 && row.fp === 0 && row.tp >= reps * 16 && (percentile(row.times, .95) ?? Infinity) <= 700)
  eligible.sort((a, b) => (percentile(a.times, .95) ?? Infinity) - (percentile(b.times, .95) ?? Infinity))
  console.log(fake ? 'No default selected from fake results.' : `Qualified default: ${eligible[0]?.model ?? 'none; keep the current model provisional'}.`)
  if (fake && providers.some((row) => row.errors || row.fp || row.fn)) process.exitCode = 1
}
await main()
