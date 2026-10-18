import { test } from 'node:test'
import assert from 'node:assert/strict'
import Reporter, { testResults } from './test-results-reporter.mjs'

test('reports retries separately from final failures without losing infrastructure errors', (t) => {
  const lines = []
  t.mock.method(console, 'log', (line) => lines.push(line))
  const reporter = new Reporter()
  const item = (id, outcome, status = 'passed') => ({ id, tags: [], titlePath: () => ['suite', id], outcome: () => outcome, results: [{ status }] })
  reporter.onBegin({}, { allTests: () => [item('retry', 'flaky'), item('failure', 'unexpected', 'failed'), item('interrupted', 'unexpected', 'interrupted')] })
  reporter.onError(new Error('worker crashed'))
  reporter.onEnd({ status: 'failed' })
  const report = testResults(lines.join('\n'))
  assert.deepEqual(report.flaky.map((test) => test.id), ['retry'])
  assert.equal(report.failures.length, 2)
  assert.equal(report.errors, 1)
  assert.equal(report.incomplete, 1)
  assert.equal(testResults('crash before reporter finishes'), undefined)
  assert.equal(testResults(lines.concat(lines).join('\n')), undefined)
})
