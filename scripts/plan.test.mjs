import { toolFixture } from './tool-test-fixture.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePlan } from './plan.mjs'
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

test('SSH job execution overlaps jobs, reports original indices, and fails missing steps when a job omits a result', async (t) => {
  const { writeFileSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { runnerPlanJobs, runRunnerPlan } = await import('./remote/plan.mjs')
  const { root: dir } = toolFixture(t)
  {
    const self = join(dir, 'remote.mjs')
    writeFileSync(self, `import {appendFileSync, readFileSync} from 'node:fs';
const args=process.argv.slice(2); const kind=args.includes('test:desktop')?'app':'unit';
appendFileSync(${JSON.stringify(join(dir, 'calls'))},JSON.stringify({kind,args,parent:process.env.JUNO_RUNNER_PARENT,time:Date.now(),event:'start'})+'\\n');
const deadline=Date.now()+5000; const timer=setInterval(()=>{if (readFileSync(${JSON.stringify(join(dir, 'calls'))},'utf8').split('\\n').filter(line=>line.includes('start')).length<2) { if(Date.now()>deadline) process.exit(2); return; } clearInterval(timer); console.log('plan: step 0 '+(kind==='app'?'test:desktop':'test')+' exited with 0 after 1 s'); appendFileSync(${JSON.stringify(join(dir, 'calls'))},JSON.stringify({kind,event:'end',time:Date.now()})+'\\n');},10);
`)
    const options = { script: 'test:plan', args: ['test', '+', 'test:desktop', '+', 'test:electron'], env: ['CUSTOM=space value'], cores: 2, wait: 60 }
    const logs = []
    assert.equal(await runRunnerPlan(runnerPlanJobs(options, {}), { self, root: dir, options, log: (line) => logs.push(line) }), 255)
    const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(calls.slice(0, 2).map((c) => c.event), ['start', 'start'])
    for (const call of calls.filter((c) => c.event === 'start')) {
      assert.equal(call.parent, '1')
      assert.ok(call.args.includes('CUSTOM=space value'))
      assert.ok(call.args.includes('JUNO_PLAN_SERIAL=1'))
      assert.ok(call.args.includes('--cores'))
      assert.ok(call.args.includes('2'))
    }
    assert.ok(logs.includes('plan: step 0 test exited with 0 after 1 s'))
    assert.ok(logs.includes('plan: step 1 test:desktop exited with 0 after 1 s'))
    assert.ok(logs.includes('plan: step 2 test:electron exited with 255 (job did not finish this step)'))
  }
})

const suites = [{ name: 'test:gallery' }, { name: 'test:desktop' }]
const passed = ['plan: step 0 test:gallery exited with 0 after 12 s', 'plan: step 1 test:desktop exited with 0 after 23 s']
const planned = { code: 0, seconds: 30, log: 'plan.log' }

test('only complete successful job reports pass, including report collection', () => {
  assert.deepEqual(planOutcomes(passed, suites, planned).map((result) => result.seconds), [12, 23])
  for (const [lines, code] of [
    [[passed[0]], 0],
    [[passed[0], passed[1].replace('test:desktop', 'test:gallery')], 0],
    [[passed[0], passed[1].replace('with 0', 'with 7')], 7],
    [passed, 255],
  ]) assert.equal(planOutcomes(lines, suites, { ...planned, code }).every((result) => result.code === 0), false)
})

test('the desktop and unit jobs take four cores in a full run and accept overrides', async () => {
  const { planCores } = await import('./remote/plan.mjs')
  const full = parsePlan(['test', '+', 'test:dom', '+', 'test:gallery'])
  assert.equal(planCores('desktop', { env: [] }, {}, []), 4)
  assert.equal(planCores('unit', { env: [] }, {}, full), 4)
  assert.equal(planCores('unit', { env: [] }, {}, parsePlan(['test', 'a.test.ts'])), undefined)
  assert.equal(planCores('unit', { env: ['JUNO_RUNNER_UNIT_CORES=3'] }, {}, full), 3)
  assert.throws(() => planCores('desktop', { env: ['JUNO_RUNNER_DESKTOP_CORES=0'] }, {}), /positive whole number/)
})
