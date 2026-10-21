import './verify-main.test.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lanes, parsePlan, sideBySide } from './plan.mjs'
import { planOutcomes } from './verify-plan.mjs'

test('a plan splits on + and reads KEY=VALUE before each script', () => {
  const steps = parsePlan(['test', '--passWithNoTests', 'a.test.ts', '+', 'GALLERY_SHIFT_ONLY=Chip,Tab', 'test:gallery', '+', 'test:desktop', 'e2e/topic.spec.ts', 'X=1'])
  assert.deepEqual(steps, [
    { env: {}, script: 'test', args: ['--passWithNoTests', 'a.test.ts'] },
    { env: { GALLERY_SHIFT_ONLY: 'Chip,Tab' }, script: 'test:gallery', args: [] },
    { env: {}, script: 'test:desktop', args: ['e2e/topic.spec.ts', 'X=1'] },
  ])
  assert.throws(() => parsePlan(['test', '+']), /needs a script/)
  assert.throws(() => parsePlan(['test:plan']), /cannot contain/)
})

test('app, unit, and spec suites run in separate lanes', () => {
  const steps = parsePlan(['test', '+', 'specs:check', '+', 'test:gallery', '+', 'test:desktop'])
  assert.deepEqual(lanes(steps, false).map((lane) => lane.map((step) => step.script)), [['test:gallery', 'test:desktop'], ['test'], ['specs:check']])
  assert.deepEqual(lanes(steps, true).map((lane) => lane.map((step) => step.script)), [['test', 'specs:check', 'test:gallery', 'test:desktop']])
  assert.equal(lanes(parsePlan(['test']), false).length, 1)
})

test('lane workers scale with the reserved cores', () => {
  assert.deepEqual(sideBySide(8), {
    app: { JUNO_E2E_WORKERS: '4', GALLERY_WORKERS: '6', GALLERY_SHIFT_PARTS: '6' },
    rest: { JUNO_VITEST_WORKERS: '2', JUNO_TEST_PACKAGE_JOBS: '1' },
    specs: { SPECS_JOBS: '2', SPECS_APALACHE: '1' },
  })
  assert.deepEqual(sideBySide(4), {
    app: { JUNO_E2E_WORKERS: '2', GALLERY_WORKERS: '3', GALLERY_SHIFT_PARTS: '3' },
    rest: { JUNO_VITEST_WORKERS: '1', JUNO_TEST_PACKAGE_JOBS: '1' },
    specs: { SPECS_JOBS: '1', SPECS_APALACHE: '1' },
  })
  assert.equal(sideBySide(2).app.JUNO_E2E_WORKERS, '1')
  assert.equal(sideBySide(1).app.GALLERY_WORKERS, '1')
})

test('wide unit-only plans keep inherited unit concurrency while other lanes stay unchanged', () => {
  const normal = sideBySide(4)
  assert.deepEqual(sideBySide(4, true), { ...normal, rest: {} })
  assert.deepEqual(normal.rest, { JUNO_VITEST_WORKERS: '1', JUNO_TEST_PACKAGE_JOBS: '1' })
})

test('SSH jobs split gallery and desktop, isolate conformance from units, and retain step indices and environments', async () => {
  const { runnerPlanJobs, planWords } = await import('./remote/plan.mjs')
  const options = { script: 'test:plan', env: [], args: ['test', '--files', 'packages/domain/test/notifications.test.ts', '+', 'specs:conformance', '+', 'GALLERY_SHIFT_ONLY=Chip', 'test:gallery', '+', 'specs:check', '+', 'test:desktop', 'e2e/app.spec.ts'] }
  const jobs = runnerPlanJobs(options, {})
  assert.deepEqual(jobs.map(({ kind, steps }) => [kind, steps.map((s) => s.index)]), [['unit', [0]], ['specs', [1, 3]], ['gallery', [2]], ['desktop', [4]]])
  assert.deepEqual(parsePlan(planWords(jobs[2].steps)), [parsePlan(options.args)[2]])
  assert.deepEqual(runnerPlanJobs(options, { JUNO_RUNNER_PLAN: 'single' }), [])
  assert.deepEqual(runnerPlanJobs({ ...options, env: ['JUNO_PLAN_SERIAL=1'] }, {}), [])
  assert.equal(runnerPlanJobs({ ...options, args: ['test:gallery', '+', 'test:desktop'] }, {}).length, 2)
})

test('SSH job execution overlaps jobs, reports original indices, and fails missing steps when a job omits a result', async () => {
  const { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { runnerPlanJobs, runRunnerPlan } = await import('./remote/plan.mjs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork' : tmpdir(), 'juno-plan-test-'))
  try {
    const self = join(dir, 'remote.mjs')
    writeFileSync(self, `import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2); const kind=args.includes('test:gallery')?'app':'unit';
appendFileSync(${JSON.stringify(join(dir, 'calls'))},JSON.stringify({kind,args,parent:process.env.JUNO_RUNNER_PARENT,time:Date.now(),event:'start'})+'\\n');
setTimeout(()=>{console.log('plan: step 0 '+(kind==='app'?'test:gallery':'test')+' exited with 0 after 1 s'); appendFileSync(${JSON.stringify(join(dir, 'calls'))},JSON.stringify({kind,event:'end',time:Date.now()})+'\\n');process.exitCode=0},200);
`)
    const options = { script: 'test:plan', args: ['test', '+', 'test:gallery', '+', 'test:desktop'], env: ['CUSTOM=space value'], cores: 2, wait: 60 }
    const logs = []
    assert.equal(await runRunnerPlan(runnerPlanJobs(options, {}), { self, root: dir, options, log: (line) => logs.push(line) }), 255)
    const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(calls.slice(0, 3).map((c) => c.event), ['start', 'start', 'start'])
    for (const call of calls.filter((c) => c.event === 'start')) {
      assert.equal(call.parent, '1')
      assert.ok(call.args.includes('CUSTOM=space value'))
      assert.ok(call.args.includes('JUNO_PLAN_SERIAL=1'))
      assert.ok(call.args.includes('--cores'))
      assert.ok(call.args.includes('2'))
    }
    assert.ok(logs.includes('plan: step 0 test exited with 0 after 1 s'))
    assert.ok(logs.includes('plan: step 1 test:gallery exited with 0 after 1 s'))
    assert.ok(logs.includes('plan: step 2 test:desktop exited with 255 (job did not finish this step)'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

const suites = [{ name: 'test:gallery' }, { name: 'test:desktop' }]
const passed = ['plan: step 0 test:gallery exited with 0 after 12 s', 'plan: step 1 test:desktop exited with 0 after 23 s']
const planned = { code: 0, seconds: 30, log: 'plan.log' }

test('split steps retain their times and a failing step fails the full run', () => {
  assert.deepEqual(planOutcomes(passed, suites, planned).map((result) => result.seconds), [12, 23])
  const results = planOutcomes([passed[0], passed[1].replace('with 0', 'with 7')], suites, { ...planned, code: 7 })
  assert.equal(results.every((result) => result.code === 0), false)
  assert.equal(results[1].code, 7)
})

test('missing results and a result for the wrong script cannot pass', () => {
  for (const lines of [[passed[0]], [passed[0], passed[1].replace('test:desktop', 'test:gallery')]]) {
    assert.equal(planOutcomes(lines, suites, planned)[1].code, 1)
  }
})

test('a report download or coordinator failure after successful steps fails the full run', () => {
  const results = planOutcomes(passed, suites, { ...planned, code: 255 })
  assert.equal(results.every((result) => result.code === 0), false)
  assert.deepEqual(results[2], { ...planned, suite: 'plan', code: 255 })
})
