import { hostname } from 'node:os'
import { checkRunner, runnerConfig } from './remote/runner.mjs'

/** Probe once before starting work. Test failures and configuration errors never trigger a rerun. */
export function verifyExecution(local, { config = runnerConfig, probe = checkRunner, log = console.log } = {}) {
  if (local) return { mode: 'local', host: hostname() }
  const runner = config()
  const health = probe(runner)
  if (health.reachable) return { mode: 'remote', host: runner.host }
  log(`verify:main: runner ${runner.host} unreachable: ${health.reason}; running the full plan on ${hostname()} through the heavy lock (no retry).`)
  return { mode: 'local', host: hostname() }
}

// Serial suites under an exclusive reservation leave room for Electron's engine
// and renderer processes and one 1536 MB Apalache JVM on the 8 GB Mac.
export const localVerifyEnv = {
  JUNO_PLAN_SERIAL: '1', JUNO_PLAN_MAX_LOAD: '8',
  JUNO_TEST_PACKAGE_JOBS: '1', JUNO_VITEST_WORKERS: '2', JUNO_TEST_FILE_PARALLEL: '1',
  JUNO_E2E_WORKERS: '1', GALLERY_WORKERS: '2', GALLERY_SHIFT_PARTS: '2',
  SPECS_JOBS: '2', SPECS_APALACHE: '1', SPECS_OVERLAP: '0', SPECS_APALACHE_HEAP: '1536m',
  CONFORMANCE_JOBS: '2', CI: '1',
}
