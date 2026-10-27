import { errorSignature } from './verify-failures.mjs'

// A complete result in the suite log lets release gates distinguish test failures
// from timeouts or worker crashes. Playwright's list reporter still shows retries.
//
// A test's time is its own: setup it waits for but does not own (a shared synced start, apps/desktop/e2e/fixtures.ts)
// adds a `warmup` annotation with its milliseconds, which is left out of `durationMs` and kept as `warmupMs`.

export default class TestResultsReporter {
  errors = 0
  completed = 0
  onBegin(_config, suite) { this.suite = suite }
  onError(error) {
    this.errors += 1
    if (this.completed === 0) this.progress({ setup: true, signature: errorSignature(error) })
  }
  progress(event) {
    if (process.env.JUNO_VERIFY_POLICY === '1') console.log(`juno-test: ${JSON.stringify(event)}`)
  }
  // A fixture that skips its test (the gallery's cached rendering tests) ends Before Hooks with an error too, so a
  // hook error counts as setup only once its test ends without being skipped.
  hookErrors = new Map()
  onStepEnd(test, _result, step) {
    if (this.completed === 0 && step.title === 'Before Hooks' && step.error) this.hookErrors.set(test, step.error)
  }
  onTestEnd(test, result) {
    const hookError = this.hookErrors.get(test)
    this.hookErrors.delete(test)
    if (result.status === 'skipped' || result.status === 'interrupted') return
    if (hookError && this.completed === 0) this.progress({ setup: true, signature: errorSignature(hookError) })
    this.completed++
    const failure = result.status !== test.expectedStatus
    this.progress({ failure, ...(failure ? { signature: errorSignature(result.error ?? result.errors?.[0]), setup: (test.parent?.project()?.name ?? '').startsWith('build-') } : {}) })
  }
  onEnd(result) {
    const tests = this.suite.allTests()
    const warmed = (run) => (run.annotations ?? []).filter((note) => note.type === 'warmup').reduce((sum, note) => sum + Number(note.description ?? 0), 0)
    const own = (run) => Math.max(0, (run.duration ?? 0) - warmed(run))
    const warmup = (test) => test.results.reduce((sum, run) => sum + warmed(run), 0)
    const describe = (test) => ({
      id: test.id, title: test.titlePath().filter(Boolean).join(' › '), tags: test.tags,
      file: test.location?.file?.replaceAll('\\', '/').replace(/^.*\/(apps|packages)\//, '$1/'),
      project: test.parent?.project()?.name,
      outcome: test.outcome(), expectedStatus: test.expectedStatus,
      durationMs: test.results.reduce((sum, run) => sum + own(run), 0),
      ...(warmup(test) > 0 ? { warmupMs: warmup(test) } : {}),
      attempts: test.results.map((run) => ({ status: run.status, durationMs: own(run), retry: run.retry ?? 0 })),
    })
    console.log(`juno-tests: ${JSON.stringify({
      status: result.status,
      errors: this.errors,
      incomplete: tests.filter((test) => test.results.length === 0 || (test.outcome() === 'skipped' && test.expectedStatus !== 'skipped') || test.results.some((run) => run.status === 'interrupted')).length,
      failures: tests.filter((test) => test.outcome() === 'unexpected').map(describe),
      flaky: tests.filter((test) => test.outcome() === 'flaky').map(describe),
      cases: tests.map(describe),
    })}`)
  }
}

/** A test failure is provisional until triage distinguishes product from test. */
export function failureCause({ code, signal, tests, unfinished = false, log = '', cause, note }) {
  if (code === 0) return undefined
  if (cause && !['product', 'test', 'infrastructure', 'cancellation'].includes(cause)) throw new Error(`Unknown failure cause: ${cause}`)
  if (cause) return { category: cause, provisional: false, evidence: note || 'Classified by the run owner' }
  if (signal || code === 130 || code === 143 || tests?.status === 'interrupted') return { category: 'cancellation', provisional: false, evidence: signal || 'Interrupted run' }
  if (unfinished || code === 255 || /lost the connection|Connection (?:refused|reset)|No space left|ENOMEM|out of memory|worker.*(?:crash|exited)/i.test(log) || tests?.errors > 0 || tests?.incomplete > 0)
    return { category: 'infrastructure', provisional: true, evidence: 'Runner, worker or incomplete-test failure; inspect the log' }
  return { category: 'test', provisional: true, evidence: 'Check failed; triage must confirm a test or product defect' }
}

export function testResults(log) {
  const lines = log.split('\n').filter((line) => line.startsWith('juno-tests: '))
  return lines.length === 1 ? JSON.parse(lines[0].slice('juno-tests: '.length)) : undefined
}
