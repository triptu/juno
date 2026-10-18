// A complete result in the suite log lets release gates distinguish test failures
// from timeouts or worker crashes. Playwright's list reporter still shows retries.
export default class TestResultsReporter {
  errors = 0
  onBegin(_config, suite) { this.suite = suite }
  onError() { this.errors += 1 }
  onEnd(result) {
    const tests = this.suite.allTests()
    const describe = (test) => ({ id: test.id, title: test.titlePath().filter(Boolean).join(' › '), tags: test.tags })
    console.log(`juno-tests: ${JSON.stringify({
      status: result.status,
      errors: this.errors,
      incomplete: tests.filter((test) => test.results.length === 0 || (test.outcome() === 'skipped' && test.expectedStatus !== 'skipped') || test.results.some((run) => run.status === 'interrupted')).length,
      failures: tests.filter((test) => test.outcome() === 'unexpected').map(describe),
      flaky: tests.filter((test) => test.outcome() === 'flaky').map(describe),
    })}`)
  }
}

export function testResults(log) {
  const lines = log.split('\n').filter((line) => line.startsWith('juno-tests: '))
  return lines.length === 1 ? JSON.parse(lines[0].slice('juno-tests: '.length)) : undefined
}
