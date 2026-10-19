import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Schema } from 'effect'
import { expect } from 'vitest'
import type { BenchmarkMode } from './chat-cache-bench'

export const Measurement = Schema.Struct({
  p50: Schema.Number, p95: Schema.Number, queryP95: Schema.Number, structuralP95: Schema.Number, warmHeap: Schema.Number,
  retainedHeap: Schema.Number, rss: Schema.Number, peakRss: Schema.Number, bytes: Schema.Number, events: Schema.Number,
  eventMs: Schema.Array(Schema.Number), queryMs: Schema.Array(Schema.Number),
})

export const measure = (mode: BenchmarkMode) => {
  const result = spawnSync(process.execPath, [
    '--expose-gc', '--import', fileURLToPath(new URL('../../../../scripts/ts-resolve-hooks.mjs', import.meta.url)),
    fileURLToPath(new URL('./chat-cache-bench.ts', import.meta.url)), mode,
  ], { encoding: 'utf8', timeout: 60_000 })
  expect(result.status, result.stderr).toBe(0)
  return Schema.decodeUnknownSync(Measurement)(JSON.parse(result.stdout))
}

