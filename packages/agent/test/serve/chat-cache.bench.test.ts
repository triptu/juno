import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Schema } from 'effect'
import { expect, it } from 'vitest'
import type { BenchmarkMode } from './chat-cache-bench'

const Measurement = Schema.Struct({
  p50: Schema.Number, p95: Schema.Number, queryP95: Schema.Number, structuralP95: Schema.Number, warmHeap: Schema.Number,
  retainedHeap: Schema.Number, rss: Schema.Number, peakRss: Schema.Number, bytes: Schema.Number, events: Schema.Number,
})

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
  for (let n = 0; n < (process.env.JUNO_CHAT_PROFILE ? 1 : 5); n++) { before.push(measure('full')); after.push(measure('cached')) }
  const report = JSON.stringify({ messages: 5000, window: 40, before, after })
  console.log(report)
  if (process.env.JUNO_CHAT_BENCH_REPORT) writeFileSync(process.env.JUNO_CHAT_BENCH_REPORT, report)
  for (const run of after) {
    expect(run.events).toBe(100)
    expect(run.queryP95).toBeLessThan(5)
    expect(run.p95).toBeLessThan(50)
    expect(run.bytes).toBeLessThan(200_000)
    // Cache retained heap, not the test runner's RSS or GC scheduling noise.
    expect(run.retainedHeap).toBeLessThan(32 * 1024 * 1024)
  }
})
