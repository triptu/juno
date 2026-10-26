import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { arch } from 'node:os'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * How a perf scenario fails (performance.md 7.3). On the Mac the budgets of
 * performance.md section 1 are absolute: a p95 (or a median where the budget
 * says so) over its budget fails. On the laptop runner the same metrics are
 * regression checks, since Electron on Xvfb in a Linux container has numbers
 * of its own. Load from other jobs only ever adds time, so the laptop
 * compares a scenario's lower quartile, which its slow samples do not move:
 * it fails when more than `RATIO` times the slowest of the baseline runs'
 * lower quartiles, plus an absolute floor. Counts of long and dropped frames
 * are recorded there but not checked. The baseline lives in
 * `perf-baseline.json` and changes only through `bun scripts/perf-baseline.mjs update`.
 */
export const RATIO = 1.2

/** Absolute floors, so a 2 ms metric does not fail on 0.5 ms of noise. */
const FLOORS = { ms: 5, MB: 20, frames: 3, '%': 5 } as const

export interface Metric {
  readonly name: string
  /** The lower quartile (nearest rank): the fastest sample of 3, the second of 5 to 8. */
  readonly low: number
  readonly median: number
  readonly p95: number
  readonly n: number
  readonly unit: keyof typeof FLOORS
  /** Every sample, sorted, for a later look at a run; omitted for long series. */
  readonly samples?: ReadonlyArray<number>
}

export interface BaselineFile {
  readonly identity: string
  readonly commit: string
  readonly recorded: string
  readonly metrics: Readonly<Record<string, { readonly low: number; readonly highLow: number; readonly median: number; readonly p95: number; readonly n: number; readonly unit: string }>>
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
 * baseline on the laptop. `floor` overrides the unit's absolute floor, as for
 * a measure that ends on a presented frame and so moves in whole frames.
 */
export function budget(metric: Metric, limit: number, options: { readonly at?: 'p95' | 'median'; readonly floor?: number } = {}): void {
  const at = options.at ?? 'p95'
  const { samples, ...summary } = metric
  record({ ...summary, ...(samples !== undefined && samples.length <= 100 ? { samples } : {}), limit, at })
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
  const ceiling = base.highLow * RATIO + (options.floor ?? FLOORS[metric.unit])
  const line = `${metric.name}: lower quartile ${metric.low.toFixed(1)} ${metric.unit} against a baseline of ${base.low.toFixed(1)}, slowest ${base.highLow.toFixed(1)} (ceiling ${ceiling.toFixed(1)})`
  console.log(line)
  // A count of missed frames says little on a shared host: the Mac checks it against zero.
  if (metric.unit === 'frames' || metric.unit === '%') return
  expect.soft(metric.low, line).toBeLessThanOrEqual(ceiling)
}

/** A single reading as a metric, for memory and other one-sample checks. */
export function reading(name: string, value: number, unit: Metric['unit']): Metric {
  return { name, low: value, median: value, p95: value, n: 1, unit }
}
