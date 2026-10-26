import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { arch } from 'node:os'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { judge, type BaselineFile } from '@juno/testing/perf-rule'

/**
 * How a perf scenario fails (performance.md 7.3). On the Mac the budgets of
 * performance.md section 1 are absolute: a p95 (or a median where the budget
 * says so) over its budget fails. On the laptop runner the same metrics are
 * regression checks against `perf-baseline.json`, since Electron on Xvfb in a
 * Linux container has numbers of its own, by the rule in `@juno/testing/perf-rule`.
 * The baseline changes only through `bun scripts/perf-baseline.mjs update`.
 */

/** Absolute floors on the laptop, so a 2 ms metric does not fail on 0.5 ms of noise. */
const FLOORS = { ms: 1, MB: 20, frames: 0, '%': 0 } as const

export interface Metric {
  readonly name: string
  /** The lower quartile (nearest rank): the fastest sample of 3, the second of 5 to 8. */
  readonly low: number
  readonly median: number
  readonly p95: number
  readonly n: number
  readonly unit: keyof typeof FLOORS
  /** Every sample, sorted, for a later look at a run. */
  readonly samples?: ReadonlyArray<number>
}

const BASELINE_PATH = resolve(__dirname, 'perf-baseline.json')

/** Absolute budgets: on the Mac, or with JUNO_PERF_ABSOLUTE=1 anywhere. */
export const absolute = process.platform === 'darwin' || process.env['JUNO_PERF_ABSOLUTE'] === '1'

/** The runner shape a baseline belongs to: numbers from another shape are not compared. */
export function runnerIdentity(): string {
  const electron = JSON.parse(readFileSync(resolve(__dirname, '../node_modules/electron/package.json'), 'utf8')) as { version: string }
  return `${process.platform}-${arch()}, ${process.env['JUNO_RUNNER_JOB_CORES'] ?? '?'} threads, Electron ${electron.version}`
}

let baseline: BaselineFile | undefined | null = null
function stored(): BaselineFile | undefined {
  if (baseline === null) baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile : undefined
  return baseline
}

/** Appends `entry` to this test's `perf-metrics.json`, which the baseline update reads. */
function record(entry: Record<string, unknown>): void {
  const file = test.info().outputPath('perf-metrics.json')
  const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as unknown[] : []
  writeFileSync(file, JSON.stringify([...list, { ...entry, identity: runnerIdentity() }], null, 1))
}

/**
 * Checks `metric` against its budget: `limit` at `at` on the Mac, the
 * baseline on the laptop. `floor` overrides the unit's absolute floor, as for
 * a measure that ends on a presented frame and so moves in whole frames.
 */
export function budget(metric: Metric, limit: number, options: { readonly at?: 'p95' | 'median'; readonly floor?: number } = {}): void {
  const at = options.at ?? 'p95'
  record({ ...metric, limit, at })
  if (absolute) {
    expect.soft(metric[at], `${metric.name}, ${at}: ${metric[at].toFixed(1)} ${metric.unit} against a budget of ${limit.toFixed(1)} ${metric.unit}`).toBeLessThanOrEqual(limit)
    return
  }
  const file = stored()
  const base = file?.identity === runnerIdentity() ? file.metrics[metric.name] : undefined
  if (base === undefined) {
    console.log(`${metric.name}: no baseline for ${runnerIdentity()}; lower quartile ${metric.low.toFixed(1)} ${metric.unit} recorded`)
    return
  }
  const verdict = judge(metric.name, metric.low, metric.unit, base, options.floor ?? FLOORS[metric.unit])
  console.log(verdict.line)
  if (verdict.ceiling !== undefined) expect.soft(metric.low, verdict.line).toBeLessThanOrEqual(verdict.ceiling)
}

/** A single reading as a metric, for memory and other one-sample checks. */
export function reading(name: string, value: number, unit: Metric['unit']): Metric {
  return { name, low: value, median: value, p95: value, n: 1, unit }
}
