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

test('real Playwright output names retry-only passes as flaky', async (t) => {
  const { execFileSync } = await import('node:child_process')
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { join, resolve } = await import('node:path')
  const { scratchFolder } = await import('./worktree-folder.mjs')
  mkdirSync(scratchFolder(), { recursive: true })
  const dir = mkdtempSync(join(scratchFolder(), 'release-reporter-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const root = resolve(import.meta.dirname, '..')
  const playwright = join(root, 'apps/desktop/node_modules/@playwright/test')
  writeFileSync(join(dir, 'reporter.spec.mjs'), `import { test, expect } from '${playwright}/index.mjs'; test('passes on retry', async ({}, info) => { expect(info.retry).toBe(1) })`)
  writeFileSync(join(dir, 'playwright.config.mjs'), `export default { testDir: '.', workers: 1, retries: 1, reporter: [['list'], ['${join(root, 'scripts/test-results-reporter.mjs')}']] }`)
  const env = { ...process.env, NO_COLOR: '1' }
  delete env.FORCE_COLOR
  const output = execFileSync(process.execPath, [join(playwright, 'cli.js'), 'test', '--config', join(dir, 'playwright.config.mjs')], { encoding: 'utf8', env })
  assert.match(output, /1 flaky/)
  const report = testResults(output)
  assert.equal(report.status, 'passed')
  assert.equal(report.flaky.length, 1)
  assert.equal(report.failures.length, 0)
})

test('failure causes distinguish cancellation and infrastructure from provisional test failures and confirmed product defects', async () => {
  const { failureCause } = await import('./test-results-reporter.mjs')
  assert.equal(failureCause({ code: 130 }).category, 'cancellation')
  assert.equal(failureCause({ code: 255 }).category, 'infrastructure')
  assert.equal(failureCause({ code: 1, tests: { incomplete: 2 } }).category, 'infrastructure')
  assert.equal(failureCause({ code: 1 }).provisional, true)
  assert.deepEqual(failureCause({ code: 1, cause: 'product', note: 'Socket update dropped a reply' }), { category: 'product', provisional: false, evidence: 'Socket update dropped a reply' })
})
