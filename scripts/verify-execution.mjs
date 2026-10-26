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
  JUNO_PLAN_SERIAL: '1', JUNO_PLAN_MAX_LOAD: process.env.JUNO_PLAN_MAX_LOAD ?? '8',
  ...budgetEnv(parseBudget(process.env.JUNO_MEMORY_BUDGET ?? '4g'), Math.max(1, availableParallelism() - 2)),
  SPECS_OVERLAP: '0', CI: '1',
}
