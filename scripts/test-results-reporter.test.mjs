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

test('a real plan keeps sparse failures, stops systemic suites, stops the run on setup failure, and lets a fixture skip cached tests', { timeout: 60_000 }, async (t) => {
  const { spawnSync } = await import('node:child_process')
  const { writeFileSync } = await import('node:fs')
  const { join, resolve } = await import('node:path')
  const { root: dir, env } = toolFixture(t)
  const root = resolve(import.meta.dirname, '..')
  const playwright = join(root, 'apps/desktop/node_modules/@playwright/test')
  const { stopFromLog } = await import('./verify-failures.mjs')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: {
    'test:browser': `node ${playwright}/cli.js test --config ${dir}/playwright.config.mjs`,
    'test:electron': 'bun next.mjs',
  } }))
  writeFileSync(join(dir, 'next.mjs'), "console.log('next suite ran')")
  writeFileSync(join(dir, 'playwright.config.mjs'), `export default { testDir: '.', workers: 1, retries: 0, reporter: [['${join(root, 'scripts/test-results-reporter.mjs')}']] }`)
  for (const scenario of ['sparse', 'mass', 'signature', 'setup', 'cached']) {
    const source = scenario === 'setup'
      ? `const test = base.extend({ fake: async ({}, use) => { throw new Error('fake not listening') } }); test('needs fake', async ({fake}) => {});`
      // The gallery's rendering tests skip from an auto fixture while unchanged since they passed (apps/gallery/support.ts).
      : scenario === 'cached'
      ? `const test = base.extend({ cached: [async ({}, use, info) => { info.skip(info.title !== 'changed', 'Unchanged since it passed'); await use() }, { auto: true }] }); test('unchanged', () => {}); test('changed', () => {});`
      : `const test = base; for (let i = 0; i < 60; i++) test('case '+i, () => {
          if (${scenario === 'sparse' ? 'i < 3' : scenario === 'mass' ? 'i < 18' : 'i % 5 === 0'}) throw new Error(${scenario === 'signature' ? "'Shared transport error'" : "'Different assertion '+i"});
        });`
    writeFileSync(join(dir, 'policy.spec.mjs'), `import { test as base } from '${playwright}/index.mjs'; ${source}`)
    const result = spawnSync(process.execPath, [join(root, 'scripts/plan.mjs'), 'test:browser', '+', 'test:electron'], {
      cwd: dir, env: { ...env, JUNO_VERIFY_POLICY: '1', JUNO_PLAN_SERIAL: '1', JUNO_PLAN_MAX_LOAD: 'Infinity' }, encoding: 'utf8', timeout: 15_000,
    })
    const output = (result.stdout + result.stderr).replace(/^\[test:browser\] /gm, '')
    assert.equal(result.status, scenario === 'cached' ? 0 : 1, scenario + output)
    const stop = stopFromLog(output)
    if (scenario === 'cached') assert.equal(stop, undefined, output)
    else if (scenario === 'sparse') {
      assert.equal(stop, undefined, output)
      assert.equal(testResults(output).cases.length, 60)
      assert.equal(testResults(output).failures.length, 3)
    } else {
      assert.equal(stop?.rule, { mass: 'failure-rate', signature: 'shared-signature', setup: 'setup' }[scenario], output)
      assert.ok(stop.completed < 60)
      if (scenario === 'signature') assert.match(stop.signature, /Shared transport error/)
    }
    assert.equal(output.includes('next suite ran'), scenario !== 'setup', output)
  }
})
