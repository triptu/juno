/**
 * The laptop's perf rule (docs/performance.md 7.3), for the desktop scenarios
 * (`apps/desktop/e2e/perfBaseline.ts`) and the package budgets (`perfBudget.ts`).
 *
 * Load on a shared host only adds time, so a metric is a scenario's lower
 * quartile, which its slow samples do not move. A busy host also lowers the
 * clock of every core, the job's pinned ones too, so each time is scaled by
 * the job's speed when it was read (`jobSpeed`) against its speed in the
 * baseline runs. A metric is checked only when it is steady: its scaled lower
 * quartile moved at most `STEADY` times between the baseline's fastest and
 * slowest runs. It fails above `RATIO` times the slowest of them plus a floor.
 * Other metrics, and counts of long and dropped frames, are printed and
 * recorded, and the Mac checks them against the absolute budgets.
 */
export const RATIO = 1.15
export const STEADY = 1.3

/** A metric in `apps/desktop/e2e/perf-baseline.json`; `low`, `fastest` and `slowest` are lower quartiles scaled to `speed`. */
export interface BaselineMetric {
  readonly low: number
  readonly fastest: number
  readonly slowest: number
  /** The job's median speed over the baseline runs when the metric was read (`jobSpeed`). */
  readonly speed: number
  readonly median: number
  readonly p95: number
  readonly runs: number
  readonly n: number
  readonly unit: string
}

export interface BaselineFile {
  readonly identity: string
  readonly commit: string
  readonly recorded: string
  readonly runs: number
  readonly metrics: Readonly<Record<string, BaselineMetric>>
}

/**
 * How fast the job runs now: the milliseconds a fixed piece of work (sorting
 * and serialising 100,000 numbers) takes, the fastest of five.
 */
export function jobSpeed(): number {
  let fastest = Infinity
  for (let round = 0; round < 5; round++) {
    const started = performance.now()
    const values = Array.from({ length: 100_000 }, (_, i) => (i * 7_919) % 100_003)
    values.sort((a, b) => a - b)
    if (JSON.stringify(values).length === 0) throw new Error('unreachable')
    fastest = Math.min(fastest, performance.now() - started)
  }
  return fastest
}

/** A time scaled to the baseline's job speed; other units as they are. */
export function scaled(value: number, unit: string, speed: number, baseSpeed: number): number {
  return unit === 'ms' ? value * baseSpeed / speed : value
}

export interface Verdict {
  /** The line to print, and the failure message. */
  readonly line: string
  /** Set when the metric is checked: the scaled value must be within it. */
  readonly ceiling?: number
  readonly value: number
}

/** Two decimals under 10, so a 1.5 ms package budget reads as it is. */
const shown = (value: number): string => value.toFixed(value < 10 ? 2 : 1)

/** The laptop's verdict on a metric's lower quartile `low`, read at job speed `speed`, against its baseline. */
export function judge(name: string, low: number, unit: string, speed: number, base: BaselineMetric, floor: number): Verdict {
  const value = scaled(low, unit, speed, base.speed)
  const at = unit === 'ms' ? ` (${shown(low)} at a job speed of ${shown(speed)} ms against ${shown(base.speed)})` : ''
  const head = `${name}: lower quartile ${shown(value)} ${unit}${at}, baseline ${shown(base.low)}, ${shown(base.fastest)} to ${shown(base.slowest)}`
  if (unit === 'frames' || unit === '%') return { line: `${head}; a count of missed frames, not checked on the laptop`, value }
  if (base.slowest > base.fastest * STEADY) return { line: `${head}; not steady, not checked on the laptop`, value }
  const ceiling = base.slowest * RATIO + floor
  return { line: `${head}; ceiling ${shown(ceiling)}`, ceiling, value }
}
