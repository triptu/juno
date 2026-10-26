/**
 * Counted budgets (docs/performance.md, "Counted budgets"): work counted for
 * one user or system action (SQL statements, rows, React renders, port
 * messages and bytes, layouts) against a fixed number. Counts do not depend
 * on the machine or its load, so a budget is exact with a little headroom and
 * runs in every test run. It fails only when the work grows; a count well
 * under its budget is printed so the budget can be lowered on purpose.
 *
 * `JUNO_WORK_COUNTS=1` prints every count (`counted work:` lines) for setting
 * or raising a budget; `JUNO_WORK_COUNTS=detail` adds what each was made of.
 */
import { expect } from 'bun:test'

export type Counts = Readonly<Record<string, number>>

/**
 * Fails when any count in `budget` is above it, naming the action, every
 * count and `detail` (what the counts were made of, such as the statements
 * by text), so the failure says what grew.
 */
export function expectWork(action: string, counts: Counts, budget: Counts, detail?: unknown): void {
  const over = Object.entries(budget).filter(([name, limit]) => (counts[name] ?? 0) > limit)
  const line = `counted work: ${action} ${JSON.stringify(counts)}`
  if (process.env['JUNO_WORK_COUNTS'] === '1') console.log(line)
  if (process.env['JUNO_WORK_COUNTS'] === 'detail') console.log(`${line}\n${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  const slack = Object.entries(budget).filter(([name, limit]) => limit > 4 && (counts[name] ?? 0) < limit * 0.75)
  if (slack.length > 0 && over.length === 0) console.log(`${line}: well under the budget ${JSON.stringify(budget)}; lower it`)
  if (over.length === 0) return
  const report = [
    `${action}: ${over.map(([name, limit]) => `${name} ${counts[name]} over its budget of ${limit}`).join(', ')}`,
    `counts ${JSON.stringify(counts)}`,
    ...(detail === undefined ? [] : [typeof detail === 'string' ? detail : JSON.stringify(detail, null, 1)]),
    'If the extra work is on purpose, raise the budget in the same change and say why (docs/performance.md, "Counted budgets").',
  ].join('\n')
  expect(over, report).toEqual([])
}
