import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'bun:test'

/**
 * A package perf budget in milliseconds (docs/performance.md 7.3), as the
 * desktop scenarios check theirs (`apps/desktop/e2e/perfBaseline.ts`): on the
 * Mac, or with JUNO_PERF_ABSOLUTE=1, `value` must be within `limit`; on the
 * laptop it must be within 1.2 times the slowest of the baseline's runs in
 * `apps/desktop/e2e/perf-baseline.json` plus `floor`. Each reading is written
 * to `apps/desktop/perf-results`, which the laptop's job brings back (the
 * desktop run clears `test-results`), for `bun scripts/perf-baseline.mjs update`.
 */
export function perfBudget(name: string, value: number, limit: number, floor = 2): void {
  if (process.platform === 'darwin' || process.env['JUNO_PERF_ABSOLUTE'] === '1') {
    expect(value, `${name}: ${value.toFixed(2)} ms against a budget of ${limit} ms`).toBeLessThanOrEqual(limit)
    return
  }
  const identity = runnerIdentity()
  const out = join(ROOT, 'apps/desktop/perf-results')
  mkdirSync(out, { recursive: true })
  const file = join(out, `${createHash('sha256').update(name).digest('hex').slice(0, 16)}.perf-metrics.json`)
  writeFileSync(file, JSON.stringify([{ name, median: value, p95: value, n: 1, unit: 'ms', limit, at: 'p95', compare: 'median', identity }], null, 1))
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) as { identity: string; metrics: Record<string, { median: number; highMedian: number }> } : undefined
  const base = baseline?.identity === identity ? baseline.metrics[name] : undefined
  if (base === undefined) {
    console.log(`${name}: no baseline for ${identity}; ${value.toFixed(2)} ms recorded`)
    return
  }
  const ceiling = base.highMedian * 1.2 + floor
  const line = `${name}: ${value.toFixed(2)} ms against a baseline of ${base.median.toFixed(2)}, slowest ${base.highMedian.toFixed(2)} (ceiling ${ceiling.toFixed(2)})`
  console.log(line)
  expect(value, line).toBeLessThanOrEqual(ceiling)
}

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BASELINE = join(ROOT, 'apps/desktop/e2e/perf-baseline.json')

/** The runner shape, as the desktop scenarios name it (`runnerIdentity` in perfBaseline.ts). */
function runnerIdentity(): string {
  const electron = JSON.parse(readFileSync(join(ROOT, 'apps/desktop/node_modules/electron/package.json'), 'utf8')) as { version: string }
  return `${process.platform}-${arch()}, ${process.env['JUNO_RUNNER_JOB_CORES'] ?? '?'} threads, Electron ${electron.version}`
}
