/**
 * A reporter for the perf and feel suites: a scenario that did not run
 * fails the run. Playwright counts a skipped test as a pass, so a shared
 * setup that throws (a serial group's `beforeAll`) or a failed scenario
 * in a serial group would otherwise leave the rest of the group unmeasured
 * and the run green.
 *
 * A scenario that cannot run yet on purpose adds a `placeholder` annotation
 * before it skips (`recordSkipped` in `feel/feel.ts` does); those are listed
 * but allowed.
 */
import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter'

export default class NoSkips implements Reporter {
  private suite: Suite | undefined

  onBegin(_config: unknown, suite: Suite): void {
    this.suite = suite
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const tests = this.suite?.allTests() ?? []
    const skipped = tests.filter((test) => test.outcome() === 'skipped')
    // Annotations added while the test runs are on its result.
    const annotations = (test: TestCase) => [...test.annotations, ...test.results.flatMap((run) => run.annotations)]
    const placeholder = (test: TestCase) => annotations(test).some((annotation) => annotation.type === 'placeholder')
    const allowed = skipped.filter(placeholder)
    const missed = skipped.filter((test) => !placeholder(test))
    for (const test of allowed) console.log(`not built yet: ${test.titlePath().slice(2).join(' › ')}`)
    if (missed.length === 0) return undefined
    console.log(`\n${missed.length} scenario${missed.length === 1 ? '' : 's'} did not run, so the run fails:`)
    for (const test of missed) {
      const reason = annotations(test).find((annotation) => annotation.type === 'skip')?.description
      console.log(`did not run: ${test.titlePath().slice(2).join(' › ')}${reason === undefined ? ' (an earlier failure in its group, or its setup, stopped it)' : ` (${reason})`}`)
    }
    return { status: result.status === 'passed' ? 'failed' : result.status }
  }

  printsToStdio(): boolean {
    return false
  }
}
