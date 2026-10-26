/**
 * The laptop's perf rule (docs/performance.md 7.3), for the desktop scenarios
 * (`apps/desktop/e2e/perfBaseline.ts`).
 *
 * Load on a shared host only adds time, so a metric is a scenario's lower
 * quartile, which its slow samples do not move. A metric is checked only when
 * it is steady: its lower quartile moved at most `STEADY` times between the
 * baseline's fastest and slowest runs. It fails above `RATIO` times the
 * slowest of them plus a floor. Other metrics, and counts of long and dropped
 * frames, are printed and recorded, and the Mac checks them against the
 * absolute budgets.
 */
export const RATIO = 1.1
export const STEADY = 1.3

/** A metric in `apps/desktop/e2e/perf-baseline.json`; `low`, `fastest` and `slowest` are the runs' lower quartiles. */
export interface BaselineMetric {
  readonly low: number
  readonly fastest: number
  readonly slowest: number
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

export interface Verdict {
  /** The line to print, and the failure message. */
  readonly line: string
  /** Set when the metric is checked: `low` must be within it. */
  readonly ceiling?: number
}

/** Two decimals under 10, so a 1.5 ms package budget reads as it is. */
const shown = (value: number): string => value.toFixed(value < 10 ? 2 : 1)

/** The laptop's verdict on a metric's lower quartile `low` against its baseline. */
export function judge(name: string, low: number, unit: string, base: BaselineMetric, floor: number): Verdict {
  const head = `${name}: lower quartile ${shown(low)} ${unit}, baseline ${shown(base.low)}, runs ${shown(base.fastest)} to ${shown(base.slowest)}`
  if (unit === 'frames' || unit === '%') return { line: `${head}; a count of missed frames, not checked on the laptop` }
  if (base.slowest > base.fastest * STEADY) return { line: `${head}; not steady, not checked on the laptop` }
  const ceiling = base.slowest * RATIO + floor
  return { line: `${head}; ceiling ${shown(ceiling)}`, ceiling }
}
