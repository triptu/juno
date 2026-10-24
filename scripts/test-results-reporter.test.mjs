import { toolFixture } from './tool-test-fixture.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testResults } from './test-results-reporter.mjs'

test('real Playwright reports retries, failures, unfinished tests and teardown errors separately', async (t) => {
  const { spawnSync } = await import('node:child_process')
  const { writeFileSync } = await import('node:fs')
  const { join, resolve } = await import('node:path')
  const { root: dir, env: fixtureEnv } = toolFixture(t)
  const root = resolve(import.meta.dirname, '..')
  const playwright = join(root, 'apps/desktop/node_modules/@playwright/test')
  writeFileSync(join(dir, 'reporter.spec.mjs'), `import { test, expect } from '${playwright}/index.mjs'; test('passes on retry', async ({}, info) => { expect(info.retry).toBe(1) }); test.describe.serial('interrupted journey', () => { test('broken', () => { expect(1).toBe(2) }); test('unfinished', () => {}) })`)
  writeFileSync(join(dir, 'teardown.mjs'), `export default () => { throw new Error('teardown failed') }`)
  writeFileSync(join(dir, 'playwright.config.mjs'), `export default { testDir: '.', globalTeardown: './teardown.mjs', workers: 1, retries: 1, reporter: [['list'], ['${join(root, 'scripts/test-results-reporter.mjs')}']] }`)
  const env = { ...fixtureEnv, CI: '1', NO_COLOR: '1' }
  delete env.FORCE_COLOR
  // Playwright's test runner runs on Node, as in the real suites.
  const result = spawnSync('node', [join(playwright, 'cli.js'), 'test', '--config', join(dir, 'playwright.config.mjs')], { encoding: 'utf8', env })
  const output = result.stdout + result.stderr
  assert.equal(result.status, 1)
  assert.match(output, /1 flaky/)
  const report = testResults(output)
  assert.equal(report.status, 'failed')
  assert.equal(report.flaky.length, 1)
  assert.equal(report.failures.length, 1)
  assert.ok(report.errors > 0)
  assert.ok(report.incomplete > 0)
  assert.equal(testResults(output + output), undefined)
  assert.equal(testResults("crash before reporter finishes"), undefined)
  assert.equal(report.cases.length, 3)
  assert.ok(report.cases[0].durationMs > 0)
  assert.deepEqual(report.cases[0].attempts.map((run) => run.status), ['failed', 'passed'])
})

test('failure causes distinguish cancellation and infrastructure from provisional test failures and confirmed product defects', async () => {
  const { failureCause } = await import('./test-results-reporter.mjs')
  assert.equal(failureCause({ code: 130 }).category, 'cancellation')
  assert.equal(failureCause({ code: 255 }).category, 'infrastructure')
  assert.equal(failureCause({ code: 1, tests: { incomplete: 2 } }).category, 'infrastructure')
  assert.equal(failureCause({ code: 1 }).provisional, true)
  assert.deepEqual(failureCause({ code: 1, cause: 'product', note: 'Socket update dropped a reply' }), { category: 'product', provisional: false, evidence: 'Socket update dropped a reply' })
})
