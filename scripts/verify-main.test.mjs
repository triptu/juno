import { toolFixture } from './tool-test-fixture.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { verifyExecution } from './verify-execution.mjs'
import { assessRecord, readRecords, releaseGate } from './release-gate.mjs'

test('explicit local skips probing; an unreachable runner fails; reachable stays remote; configuration errors fail', () => {
  let calls = 0
  const deps = { config: () => ({ host: 'runner' }), probe: () => { calls++; return { reachable: false, reason: 'offline' } } }
  assert.deepEqual(verifyExecution(true, deps), { mode: 'local', host: hostname() })
  assert.equal(calls, 0)
  assert.throws(() => verifyExecution(false, deps), /runner unreachable: offline.*do not fall back to this Mac/)
  assert.equal(calls, 1)
  assert.deepEqual(verifyExecution(false, { ...deps, probe: () => ({ reachable: true }) }), { mode: 'remote', host: 'runner' })
  assert.throws(() => verifyExecution(false, { ...deps, probe: () => { throw new Error('SSH configuration failed') } }), /SSH configuration failed/)
})

function verificationFixture(t) {
  const { root, env: fixtureEnv, git: fixtureGit } = toolFixture(t)
  cpSync(resolve(import.meta.dirname), join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'apps/desktop/e2e'), { recursive: true })
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'bin/package.json'), '{"type":"commonjs"}')
  mkdirSync(join(root, 'tstack/scripts/runner'), { recursive: true })
  writeFileSync(join(root, 'tstack/scripts/runner/host.sh'), '# fixture\n')
  writeFileSync(join(root, 'package.json'), '{"type":"module","scripts":{},"packageManager":"bun@1.4.4","devDependencies":{"@informalsystems/quint":"0.33.0"}}')
  writeFileSync(join(root, 'bin/bun'), `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === '--version' || argv[0] === '--revision') { console.log('1.4.4'); process.exit(0); }
const [suite, ...args] = argv[0] === 'run' ? argv.slice(1) : argv;
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({suite,args,held:process.env.JUNO_HEAVY_HELD,skip:process.env.JUNO_SKIP_TAGS,coverage:process.env.JUNO_COVERAGE,workers:process.env.JUNO_E2E_WORKERS})+'\\n');
if (suite === 'install') { fs.writeFileSync('installed', 'yes'); if (!fs.existsSync('node_modules')) fs.symlinkSync(${JSON.stringify(resolve(import.meta.dirname, '../node_modules'))}, 'node_modules', 'dir'); process.exit(0); }
if (!fs.existsSync('installed')) process.exit(9);
if (suite === 'test:desktop' && process.env.JUNO_COVERAGE === '1') {
  fs.mkdirSync('apps/desktop/coverage/map', {recursive:true});
  fs.writeFileSync('apps/desktop/coverage/map/partial-local.json', JSON.stringify({specs:{'apps/desktop/e2e/app.spec.ts':['apps/desktop/src/main.ts']},bundled:['apps/desktop/src/main.ts']}));
}
console.log('fixture '+suite);
process.exit(suite === process.env.TEST_FAIL_SUITE ? 7 : 0);
`)
  writeFileSync(join(root, 'bin/ssh'), `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.TEST_PROBES, 'probe\\n');
console.error('Connection refused'); process.exit(255);
`)
  for (const name of ['bun', 'ssh']) chmodSync(join(root, 'bin', name), 0o755)
  writeFileSync(join(root, '.gitignore'), 'node_modules\nhome\ntmp\n.juno-status\n')
  fixtureGit('init', '-q', '-b', 'main')
  fixtureGit('config', 'user.name', 'Test')
  fixtureGit('config', 'user.email', 'test@example.com')
  fixtureGit('add', '.')
  fixtureGit('commit', '-qm', 'Fixture')
  const commit = fixtureGit('rev-parse', 'HEAD')
  // TMPDIR keeps the heavy lock inside the fixture, so other jobs on the machine cannot hold it.
  const env = { ...fixtureEnv, JUNO_PLAN_MAX_LOAD: 'Infinity', TMPDIR: join(root, 'tmp'), PATH: `${join(root, 'bin')}:${process.env.PATH}`, TSTACK_HOME: join(root, 'tstack'), JUNO_RUNNER_HOST: 'runner.test', TEST_CALLS: join(root, 'calls'), TEST_PROBES: join(root, 'probes') }
  const invoke = (args, extra = {}) => spawnSync(process.execPath, ['scripts/verify-main.mjs', '--ref', 'HEAD', ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60_000 })
  return { root, commit, env, invoke, git: fixtureGit }
}

test('local runs archive eligible records, refresh coverage, and preserve failed suites; an unreachable runner runs nothing', { timeout: 120_000 }, (t) => {
  const { root, commit, env, invoke } = verificationFixture(t)
  const dry = invoke(['--local', '--dry-run', '--nightly'])
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /SPECS_SEED=\d+ specs:check/)
  assert.match(dry.stdout, /test:desktop --grep @mac, then perf, then test:feel/)
  assert.equal(existsSync(join(root, '.juno-status')), false)
  assert.equal(existsSync(env.TEST_CALLS), false)
  for (const [args, failing] of [[['--local'], false], [['--local', '--nightly'], false], [['--local', '--with-mac', '--no-cache'], true]]) {
    writeFileSync(env.TEST_CALLS, '')
    const result = invoke(args, { TEST_FAIL_SUITE: failing ? 'specs:conformance' : '' })
    assert.equal(result.status, failing ? 1 : 0, result.stderr + result.stdout)
    const summary = JSON.parse(readFileSync(join(root, '.juno-status/verify-main.json'), 'utf8'))
    assert.deepEqual(summary.execution, { mode: 'local', host: hostname() })
    assert.equal(assessRecord(summary), !failing)
    assert.equal(summary.passed, !failing)
    assert.deepEqual(summary.suites.filter((s) => summary.required.includes(s.suite)).map((s) => s.suite).toSorted(), ['test', 'specs:check', 'specs:conformance', 'test:gallery', 'test:desktop'].toSorted())
    assert.ok(summary.suites.every((s) => s.host === hostname()))
    const calls = readFileSync(env.TEST_CALLS, 'utf8').trim().split('\n').map(JSON.parse)
    const desktop = calls.find((c) => c.suite === 'test:desktop')
    assert.equal(desktop.coverage, args.includes('--nightly') ? '1' : undefined)
    assert.equal(desktop.skip, '@mac')
    assert.equal(desktop.workers, '1')
    if (args.includes('--nightly')) {
      const map = JSON.parse(readFileSync(join(root, 'apps/desktop/e2e/coverage-map.json'), 'utf8'))
      assert.equal(map.commit, commit)
      assert.deepEqual(map.files, { 'apps/desktop/src/main.ts': [0] })
      assert.ok(summary.suites.find((s) => s.suite === 'specs:conformance').reusedFrom)
      assert.ok(!calls.some((c) => c.suite === 'specs:conformance'))
    }
    if (failing) {
      assert.equal(summary.suites.find((s) => s.suite === 'specs:conformance').code, 7)
      assert.equal(summary.suites.find((s) => s.suite === 'specs:conformance').cause.category, 'test')
      assert.deepEqual(calls.slice(6).map((c) => c.suite), ['test:desktop', 'perf', 'test:feel'])
      assert.deepEqual(calls[6].args, ['--grep', '@mac'])
      assert.equal(calls[6].skip, undefined)
    }
  }
  writeFileSync(env.TEST_CALLS, '')
  const unreachable = invoke(['--nightly'])
  assert.notEqual(unreachable.status, 0)
  assert.match(unreachable.stderr, /unreachable.*do not fall back to this Mac/)
  assert.equal(readFileSync(env.TEST_CALLS, 'utf8'), '')
  assert.equal(readFileSync(env.TEST_PROBES, 'utf8'), 'probe\n')
  assert.equal(readRecords(join(root, '.juno-status')).filter((r) => r.execution).length, 3)
  assert.equal(releaseGate(root, commit).record.passed, true)
})

test('repair selects failed and unfinished files plus every reached spec, and refuses another runtime', async () => {
  const { repairPlan, mergeRepairTests } = await import('./verify-repair.mjs')
  const identity = { bun: '1.4.4', platform: 'linux', arch: 'x64', electron: '44.7.0' }
  const item = (file, outcome, attempts = [{ status: 'passed' }]) => ({ file: `apps/desktop/e2e/${file}.spec.ts`, project: 'electron', outcome, attempts })
  const previous = { status: 'failed', errors: 0, incomplete: 1, failures: [], cases: [item('good', 'expected'), item('bad', 'unexpected', [{ status: 'failed' }]), item('unfinished', 'skipped', [])] }
  const baseline = { commit: 'a', finishedAt: 'then', identity, suites: [{ suite: 'test:desktop', code: 1, tests: previous }, { suite: 'test:gallery', code: 0 }] }
  const suites = ['test:desktop', 'test:gallery', 'test'].map((name) => ({ name, words: [name] }))
  const affected = [{ script: 'test:desktop', args: ['e2e/reached.spec.ts'], items: [] }]
  const result = repairPlan({ baseline, identity, suites, affected })
  assert.deepEqual(result.planned[0].words, ['test:desktop', 'e2e/bad.spec.ts', 'e2e/unfinished.spec.ts', 'e2e/reached.spec.ts'])
  assert.equal(result.reused[0].suite, 'test:gallery')
  assert.deepEqual(result.planned[1].words, ['test'])
  assert.throws(() => repairPlan({ baseline, identity: { ...identity, platform: 'darwin' }, suites, affected }), /runtime/)
  const repaired = mergeRepairTests(previous, { status: 'passed', errors: 0, incomplete: 0, failures: [], cases: [item('bad', 'expected'), item('unfinished', 'expected'), item('reached', 'expected')] })
  assert.equal(repaired.cases.length, 4)
  assert.equal(repaired.failures.length, 0)
  assert.equal(repaired.incomplete, 0)
  assert.equal(repairPlan({ baseline, identity, suites, affected: [{ script: 'test:desktop', args: [] }] }).planned[0].words.length, 1)
})

test('runtime and platform changes invalidate recorded results; reports survive checkout removal', async (t) => {
  const { inputKey } = await import('./verify-inputs.mjs')
  const { keepReports } = await import('./verify-reports.mjs')
  const { root } = toolFixture(t)
  const checkout = join(root, 'checkout')
  const report = 'apps/desktop/test-results/results.json'
  mkdirSync(join(checkout, 'apps/desktop/test-results'), { recursive: true })
  writeFileSync(join(checkout, report), '{"suites":[],"stats":{"duration":12}}')
  const identity = { bun: '1', platform: 'linux', arch: 'x64', electron: '44' }
  const key = inputKey(checkout, [report], identity)
  for (const field of ['bun', 'platform', 'arch', 'electron']) assert.notEqual(inputKey(checkout, [report], { ...identity, [field]: 'different' }), key)
  const kept = keepReports(checkout, join(root, 'status'), 0)
  rmSync(checkout, { recursive: true, force: true })
  assert.equal(kept.length, 1)
  assert.equal(JSON.parse(readFileSync(kept[0], 'utf8')).stats.duration, 12)
})

test('a repair installs its planner, reruns the failed suite, and retains passing suites at the fix commit', { timeout: 30_000 }, (t) => {
  const { root, env, invoke, git: fixtureGit } = verificationFixture(t)
  const failed = invoke(['--local'], { TEST_FAIL_SUITE: 'test:desktop' })
  assert.equal(failed.status, 1, failed.stderr + failed.stdout)
  const baseline = join(root, '.juno-status/verify-main.json')
  writeFileSync(join(root, 'app.ts'), 'fixed')
  fixtureGit('add', 'app.ts')
  fixtureGit('commit', '-qm', 'Fix')
  writeFileSync(env.TEST_CALLS, '')
  const repaired = invoke(['--local', '--repair', baseline])
  assert.equal(repaired.status, 0, repaired.stderr + repaired.stdout)
  const record = JSON.parse(readFileSync(baseline, 'utf8'))
  assert.equal(record.commit, fixtureGit('rev-parse', 'HEAD'))
  assert.equal(record.suites.filter((suite) => suite.reusedFrom).length, 4)
  assert.deepEqual(readFileSync(env.TEST_CALLS, 'utf8').trim().split('\n').map(JSON.parse).map((call) => call.suite), ['install', 'test:desktop', 'lint'])
  assert.ok(releaseGate(root, record.commit))
})
