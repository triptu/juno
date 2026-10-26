import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'bun:test'
import { judge, type BaselineFile } from './perfRule'

/**
 * A package perf budget in milliseconds (docs/performance.md 7.3), as the
 * desktop scenarios check theirs (`apps/desktop/e2e/perfBaseline.ts`): on the
 * Mac, or with JUNO_PERF_ABSOLUTE=1, `value` must be within `limit`; on the
 * laptop it is checked against the baseline by the rule in `perfRule.ts`, with
 * `floor` added to the ceiling. Each reading is written to
 * `apps/desktop/perf-results`, which the laptop's job brings back (the desktop
 * run clears `test-results`), for `bun scripts/perf-baseline.mjs update`.
 */
export function perfBudget(name: string, value: number, limit: number, floor = 1): void {
  if (process.platform === 'darwin' || process.env['JUNO_PERF_ABSOLUTE'] === '1') {
    expect(value, `${name}: ${value.toFixed(2)} ms against a budget of ${limit} ms`).toBeLessThanOrEqual(limit)
    return
  }
  const identity = runnerIdentity()
  const out = join(ROOT, 'apps/desktop/perf-results')
  mkdirSync(out, { recursive: true })
  const file = join(out, `${createHash('sha256').update(name).digest('hex').slice(0, 16)}.perf-metrics.json`)
  writeFileSync(file, JSON.stringify([{ name, low: value, median: value, p95: value, n: 1, unit: 'ms', limit, at: 'p95', identity }], null, 1))
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) as BaselineFile : undefined
  const base = baseline?.identity === identity ? baseline.metrics[name] : undefined
  if (base === undefined) {
    console.log(`${name}: no baseline for ${identity}; ${value.toFixed(2)} ms recorded`)
    return
  }
  const verdict = judge(name, value, 'ms', base, floor)
  console.log(verdict.line)
  if (verdict.ceiling !== undefined) expect(value, verdict.line).toBeLessThanOrEqual(verdict.ceiling)
}

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BASELINE = join(ROOT, 'apps/desktop/e2e/perf-baseline.json')

/** The runner shape, as the desktop scenarios name it (`runnerIdentity` in perfBaseline.ts). */
function runnerIdentity(): string {
  const electron = JSON.parse(readFileSync(join(ROOT, 'apps/desktop/node_modules/electron/package.json'), 'utf8')) as { version: string }
  return `${process.platform}-${arch()}, ${process.env['JUNO_RUNNER_JOB_CORES'] ?? '?'} threads, Electron ${electron.version}`
}
