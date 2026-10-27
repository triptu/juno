import type { TestInfo } from '@playwright/test'

/**
 * Setup a test waits for but does not own: the run's browser snapshot, which the first worker to ask builds while
 * the others wait, or this worker's synced workspace, which its first synced test builds. Its time goes back to the
 * test's timeout, its lane's limit on the test's own time, and a `warmup` annotation keeps it out of the time the
 * results reporter records (scripts/test-results-reporter.mjs).
 */
export async function warmup<A>(testInfo: TestInfo, work: () => Promise<A>): Promise<A> {
  const started = performance.now()
  const limit = testInfo.timeout
  // Slow: while the setup runs the test's deadline waits (a build is bounded by its own two minutes); after it, the
  // test has its whole limit for its own time.
  if (limit > 0) testInfo.setTimeout(limit + WARMUP_BOUND_MS)
  try {
    return await work()
  } finally {
    const ms = Math.round(performance.now() - started)
    // Slow: gives back only the time of setup the test does not own.
    if (limit > 0) testInfo.setTimeout(limit + ms)
    testInfo.annotations.push({ type: 'warmup', description: String(ms) })
  }
}

/** How long a shared synced start may take to build or wait for; the snapshot lock gives up at two minutes too. */
const WARMUP_BOUND_MS = 120_000
