import { expect } from 'bun:test'

/**
 * A package perf budget in milliseconds (docs/performance.md 7.3): `value` must be within `limit`. The package
 * budgets run on the Mac only (`bun run perf`); their p95s of a few milliseconds are not steady on the laptop.
 */
export function perfBudget(name: string, value: number, limit: number): void {
  expect(value, `${name}: ${value.toFixed(2)} ms against a budget of ${limit} ms`).toBeLessThanOrEqual(limit)
}
