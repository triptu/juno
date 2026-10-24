import { hostname } from 'node:os'
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

// Serial suites under an exclusive reservation leave room for Electron's engine
// and renderer processes and one 1536 MB Apalache JVM on the 8 GB Mac.
export const localVerifyEnv = {
  JUNO_PLAN_SERIAL: '1', JUNO_PLAN_MAX_LOAD: '8',
  JUNO_TEST_WORKERS: '4',
  JUNO_BROWSER_WORKERS: '2', JUNO_E2E_WORKERS: '1', GALLERY_WORKERS: '3', GALLERY_SHIFT_PARTS: '3',
  SPECS_JOBS: '2', SPECS_APALACHE: '1', SPECS_OVERLAP: '0', SPECS_APALACHE_HEAP: '1536m',
  CONFORMANCE_JOBS: '2', CI: '1',
}
