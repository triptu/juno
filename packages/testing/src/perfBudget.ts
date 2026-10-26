import { expect } from 'bun:test'

/**
 * A package perf budget in milliseconds (docs/performance.md 7.3), run by `bun run perf --full`, `--area` or
 * `--unit`: on the Mac, or with JUNO_PERF_ABSOLUTE=1, `value` must be within `limit`. The laptop has no baseline for
 * these, since their p95s of a few milliseconds are not steady there: it prints the value and passes.
 */
export function perfBudget(name: string, value: number, limit: number): void {
  if (process.platform !== 'darwin' && process.env['JUNO_PERF_ABSOLUTE'] !== '1') {
    console.log(`${name}: ${value.toFixed(2)} ms (budget ${limit} ms on the Mac), not checked on the laptop`)
    return
  }
  expect(value, `${name}: ${value.toFixed(2)} ms against a budget of ${limit} ms`).toBeLessThanOrEqual(limit)
}
