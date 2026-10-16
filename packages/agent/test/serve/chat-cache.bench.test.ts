import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Schema } from 'effect'
import { expect, it } from 'vitest'
import type { BenchmarkMode } from './chat-cache-bench'

const Measurement = Schema.Struct({
  p50: Schema.Number, p95: Schema.Number, queryP95: Schema.Number, structuralP95: Schema.Number, warmHeap: Schema.Number,
  retainedHeap: Schema.Number, rss: Schema.Number, peakRss: Schema.Number, bytes: Schema.Number, events: Schema.Number,
  eventMs: Schema.Array(Schema.Number), queryMs: Schema.Array(Schema.Number),
})

const percentile = (values: ReadonlyArray<number>, p: number) => values.toSorted((a, b) => a - b)[Math.floor(values.length * p)]!

const measure = (mode: BenchmarkMode) => {
  const result = spawnSync(process.execPath, [
    '--expose-gc', '--import', fileURLToPath(new URL('../../../../scripts/ts-resolve-hooks.mjs', import.meta.url)),
    fileURLToPath(new URL('./chat-cache-bench.ts', import.meta.url)), mode,
  ], { encoding: 'utf8', timeout: 60_000 })
  expect(result.status, result.stderr).toBe(0)
  return Schema.decodeUnknownSync(Measurement)(JSON.parse(result.stdout))
}

it('5,000 messages: event to encoded window, query and payload stay within budget', () => {
  const before = []
  const after = []
  // The uncached baseline (about 6 s a run) is only for the comparison report; the budgets below check the cache.
  const compare = process.env.JUNO_CHAT_BENCH_REPORT !== undefined
  for (let n = 0; n < (process.env.JUNO_CHAT_PROFILE ? 1 : 5); n++) {
    if (compare) before.push(measure('full'))
    after.push(measure('cached'))
  }
  const summary = (runs: ReadonlyArray<typeof Measurement.Type>) => runs.map(({ eventMs: _event, queryMs: _query, ...run }) => run)
  // A budget is a p95 over every run of the scenario (docs/performance.md, section 1): pool the five processes' events.
  // One process's p95 rests on its five slowest events, so a shared machine's scheduling stall failed it alone.
  const p95 = percentile(after.flatMap((run) => run.eventMs), 0.95)
  const queryP95 = percentile(after.flatMap((run) => run.queryMs), 0.95)
  const report = JSON.stringify({ messages: 5000, window: 40, p95, queryP95, before: summary(before), after: summary(after) })
  console.log(report)
  if (process.env.JUNO_CHAT_BENCH_REPORT) writeFileSync(process.env.JUNO_CHAT_BENCH_REPORT, report)
  expect(queryP95).toBeLessThan(5)
  expect(p95).toBeLessThan(50)
  for (const run of after) {
    expect(run.events).toBe(100)
    expect(run.bytes).toBeLessThan(200_000)
    // Cache retained heap, not the test runner's RSS or GC scheduling noise.
    expect(run.retainedHeap).toBeLessThan(32 * 1024 * 1024)
  }
})
