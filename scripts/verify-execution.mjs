import { availableParallelism, hostname } from 'node:os'
import { budgetEnv, parseBudget } from './memory-budget.mjs'
import { checkRunner, runnerConfig } from './remote/runner.mjs'

/**
 * Probe once before starting work. An unreachable runner fails the run: heavy
 * suites never move to this Mac on their own, because it hangs under them.
 * `--local` runs here only when Tushar asks for it.
 */
export function verifyExecution(local, { config = runnerConfig, probe = checkRunner } = {}) {
  if (local) return { mode: 'local', host: hostname() }
  const runner = config()
  const health = probe(runner)
  if (health.reachable) return { mode: 'remote', host: runner.host }
  throw new Error(`verify:main: runner ${runner.host} unreachable: ${health.reason}. Heavy runs do not fall back to this Mac; wait for the runner (\`bun run runner:check\`), or pass --local only when Tushar asks.`)
}

// Serial suites under an exclusive reservation. Workers per lane fit a memory budget
// (JUNO_MEMORY_BUDGET, 4g by default) on all but two threads, so the 8 GB Mac keeps two cores and
// about 4 GB for other use (scripts/memory-budget.mjs).
export const localVerifyEnv = {
  // Before each step, wait while other work keeps more than half the cores busy (scripts/plan.mjs, busyCores).
  JUNO_PLAN_SERIAL: '1', JUNO_PLAN_MAX_BUSY: process.env.JUNO_PLAN_MAX_BUSY ?? String(Math.max(2, Math.floor(availableParallelism() / 2))),
  ...budgetEnv(parseBudget(process.env.JUNO_MEMORY_BUDGET ?? '4g'), Math.max(1, availableParallelism() - 2)),
  // Three browser workers on the 8-core Mac (four efficiency cores): 78 s at a peak load of 8.8, against 70 to 78 s
  // with four, whose own threads alone reached 17 runnable (10-27, docs/development.md, "Full runs").
  JUNO_BROWSER_WORKERS: process.env.JUNO_BROWSER_WORKERS ?? String(Math.max(1, Math.floor(availableParallelism() * 3 / 8))),
  SPECS_OVERLAP: '0', CI: '1',
}
