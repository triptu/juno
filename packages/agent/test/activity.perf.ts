// The Activity page's read time against the Juno switcher budget (docs/performance.md), alone under bun run perf --unit:
// beside the other packages' tests, one cold read measured the machine, not the query.
import { afterEach, it } from 'bun:test'
import { activityPage } from '../src/serve/pages'
import { seedRuns } from './activity-seed'
import { fakeHost, turnsHarness } from './turns-harness'
import { perfBudget } from '@juno/testing/perf-budget'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
})

it('500 runs: the newest window is built within the agent\'s share of the switch budget', async () => {
  const h = await turnsHarness({ host: fakeHost().host })
  cleanups.push(h.close)
  seedRuns(h.turns.store.db, 500)
  // The first read prepares its statements, as the first open of Activity does: it keeps the budget too.
  const coldStarted = performance.now()
  activityPage(h.turns.store, { limit: 50 })
  const cold = performance.now() - coldStarted
  const times: number[] = []
  for (let n = 0; n < 9; n++) {
    const started = performance.now()
    activityPage(h.turns.store, { limit: 50 })
    times.push(performance.now() - started)
  }
  const median = times.toSorted((a, b) => a - b)[4]!
  // The agent's share of the switch budget (docs/performance.md, "Juno switcher"), with room for a slow machine.
  perfBudget('activity: newest window, cold', cold, 40)
  perfBudget('activity: newest window, median', median, 40)
})
