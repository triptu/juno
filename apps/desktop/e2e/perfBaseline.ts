import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { arch } from 'node:os'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * How a perf scenario fails (performance.md 7.3). On the Mac the budgets of
 * performance.md section 1 are absolute: a p95 (or a median where the budget
 * says so) over its budget fails. On the laptop runner the same metrics are
 * regression checks: the median fails when it is more than `RATIO` times the
 * stored baseline from the same runner shape plus an absolute floor, since
 * Electron on Xvfb in a Linux container has numbers of its own. The baseline lives
 * in `perf-baseline.json` and changes only through
 * `bun scripts/perf-baseline.mjs update`.
 */
export const RATIO = 1.2

/** Absolute floors, so a 2 ms metric does not fail on 0.5 ms of noise. */
const FLOORS = { ms: 5, MB: 20 } as const

export interface Metric {
  readonly name: string
  readonly median: number
  readonly p95: number
  readonly n: number
  readonly unit: keyof typeof FLOORS
}

export interface BaselineFile {
  readonly identity: string
  readonly commit: string
  readonly recorded: string
  readonly metrics: Readonly<Record<string, { readonly median: number; readonly p95: number; readonly n: number; readonly unit: string }>>
}

export const BASELINE_PATH = resolve(__dirname, 'perf-baseline.json')

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
 * baseline on the laptop. The laptop compares medians, or p95s with
 * `compare: 'p95'` for a metric of hundreds of samples, such as the work of
 * every frame of a scroll. `floor` overrides the unit's absolute floor, as for
 * a measure that ends on a presented frame and so moves in whole frames.
 */
export function budget(metric: Metric, limit: number, options: { readonly at?: 'p95' | 'median'; readonly compare?: 'p95' | 'median'; readonly floor?: number } = {}): void {
  const at = options.at ?? 'p95'
  const compare = options.compare ?? 'median'
  record({ name: metric.name, median: metric.median, p95: metric.p95, n: metric.n, unit: metric.unit, limit, at, compare })
  if (absolute) {
    expect.soft(metric[at], `${metric.name}, ${at}: ${metric[at].toFixed(1)} ${metric.unit} against a budget of ${limit.toFixed(1)} ${metric.unit}`).toBeLessThanOrEqual(limit)
    return
  }
  const file = stored()
  const base = file?.identity === runnerIdentity() ? file.metrics[metric.name] : undefined
  if (base === undefined) {
    console.log(`${metric.name}: no baseline for ${runnerIdentity()}; ${compare} ${metric[compare].toFixed(1)} ${metric.unit} recorded`)
    return
  }
  const ceiling = base[compare] * RATIO + (options.floor ?? FLOORS[metric.unit])
  const line = `${metric.name}: ${compare} ${metric[compare].toFixed(1)} ${metric.unit} against a baseline of ${base[compare].toFixed(1)} (ceiling ${ceiling.toFixed(1)})`
  console.log(line)
  expect.soft(metric[compare], line).toBeLessThanOrEqual(ceiling)
}

/** A single reading as a metric, for memory and other one-sample checks. */
export function reading(name: string, value: number, unit: Metric['unit']): Metric {
  return { name, median: value, p95: value, n: 1, unit }
}
