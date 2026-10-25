import { parseRun, report } from './usage.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { hostCommand, runnerConfig, runnerJobSize } from './runner.mjs'
import { runnerHarness } from './runner-test-harness.mjs'

function fixture(t) {
  const harness = runnerHarness()
  const checkout = join(harness.dir, 'checkout')
  mkdirSync(checkout)
  cpSync(resolve('scripts'), join(checkout, 'scripts'), { recursive: true })
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ packageManager: 'bun@1.4.4', devDependencies: { '@informalsystems/quint': '0.33.0' } }))
  t.after(() => rmSync(harness.dir, { recursive: true, force: true }))
  return { ...harness, checkout, run(args, env = {}) {
    const result = spawnSync(process.execPath, ['scripts/remote.mjs', ...args], { cwd: checkout, env: { ...harness.env, ...env }, encoding: 'utf8', timeout: 20_000 })
    const output = result.stdout + result.stderr
    return { ...result, output }
  }, calls: () => readFileSync(harness.calls, 'utf8').trim().split('\n').map(JSON.parse) }
}

test('workload sizing uses whole cores and rejects an oversized explicit request', () => {
  const size = (script, args = [], extra = {}, capacity = 8) => runnerJobSize({ script, args, ...extra }, capacity)
  for (const capacity of [1, 2, 8]) {
    for (const script of ['test', 'test:desktop', 'test:gallery', 'specs:check', 'specs:conformance']) {
      const reserved = size(script, [], {}, capacity).reserved
      assert.ok(Number.isInteger(reserved) && reserved > 0 && reserved <= capacity)
    }
  }
  assert.ok(size('test', ['test/messages.test.ts']).reserved <= size('test').reserved)
  assert.equal(size('test', [], { cores: 3 }).reserved, 3)
  assert.throws(() => size('test', [], { cores: 9 }), /runner lends 8/)
})

test('SSH configuration validates host, port and image and explains missing tstack', () => {
  assert.throws(() => runnerConfig({ HOME: '/nonexistent', JUNO_RUNNER_HOST: '' }), /Configure.*--local/)
  for (const value of [{ JUNO_RUNNER_HOST: '-option' }, { JUNO_RUNNER_PORT: '0' }, { JUNO_RUNNER_IMAGE: 'bad;image' }]) assert.throws(() => runnerConfig({ HOME: '/nonexistent', JUNO_RUNNER_HOST: 'runner', ...value }))
  assert.throws(() => hostCommand('check', [], { TSTACK_HOME: '/nonexistent' }), /Install tstack with \/tstack:setup/)
})

test('CLI uploads the workspace, uses host allocation and preserves the test exit code', (t) => {
  const f = fixture(t)
  const result = f.run(['test', '--passWithNoTests', 'test/messages.test.ts'], { TEST_CODE: '7' })
  assert.equal(result.status, 7, result.output)
  const run = f.calls().find((call) => call.sub === 'run')
  assert.ok(run.args.includes('cores=1'))
  assert.ok(run.args.includes('memory=3g'))
  assert.ok(run.args.includes('image=test/image:tag'))
  assert.ok(run.args.includes('wait=60'))
  const upload = f.calls().find((call) => call.upload)
  assert.equal(upload.upload, upload.expected)
  const log = /remote: output in (.+)/.exec(result.output)[1]
  assert.equal(JSON.parse(readFileSync(join(f.checkout, log), 'utf8').match(/^remote: summary (.+)$/m)[1]).threads, 6)
})

test('missing tstack, unreachable hosts and full hosts fail with actionable messages', (t) => {
  const f = fixture(t)
  for (const [env, code, message] of [[{ TSTACK_HOME: '/nonexistent' }, 255, /\/tstack:setup/], [{ TEST_MODE: 'unreachable' }, 255, /runner unreachable.*--local/], [{ TEST_MODE: 'busy' }, 75, /full past the wait.*--local/], [{ TEST_MODE: 'lost' }, 255, /lost the connection/]]) {
    const result = f.run(['test', 'test/messages.test.ts'], env)
    assert.equal(result.status, code, result.output)
    assert.match(result.output, message)
  }
})

test('toolchain builds go through the shared host and failures stop before admission', (t) => {
  const f = fixture(t)
  const result = f.run(['test', 'test/messages.test.ts'], { JUNO_RUNNER_IMAGE: '', TEST_MODE: 'build-failed' })
  assert.equal(result.status, 255, result.output)
  assert.match(result.output, /image build failed/)
  assert.deepEqual(f.calls().map((call) => call.sub), ['check', 'build'])
})

test('a full plan runs as two jobs that fit the eight lent cores together and retain original results', (t) => {
  const f = fixture(t)
  const result = f.run(['--wait', '120', 'test:plan', 'test', '+', 'test:dom', '+', 'specs:check', '+', 'specs:conformance', '+', 'test:gallery', '+', 'test:browser', '+', 'test:electron'])
  assert.equal(result.status, 0, result.output)
  const jobs = f.calls().filter((call) => call.sub === 'run')
  assert.equal(jobs.length, 2)
  const cores = jobs.map((job) => Number(job.args.find((arg) => arg.startsWith('cores=')).slice(6)))
  assert.ok(cores.reduce((sum, count) => sum + count, 0) <= 8, `${cores}`)
  for (const job of jobs) assert.ok(job.args.includes('wait=120'))
  for (const [index, script] of ['test', 'test:dom', 'specs:check', 'specs:conformance', 'test:gallery', 'test:browser', 'test:electron'].entries()) assert.match(result.output, new RegExp(`plan: step ${index} ${script} exited with 0`))
})

test('split plans allow queued jobs to wait and keep an explicit wait override', (t) => {
  const f = fixture(t)
  const args = ['test:plan', 'test:gallery', '+', 'test:desktop']
  assert.equal(f.run(args).status, 0)
  const jobs = f.calls().filter((call) => call.sub === 'run')
  assert.equal(jobs.length, 2)
  for (const job of jobs) assert.ok(job.args.includes('wait=3600'))
  assert.equal(f.run(args, { JUNO_RUNNER_WAIT: '120' }).status, 0)
  for (const job of f.calls().filter((call) => call.sub === 'run').slice(2)) assert.ok(job.args.includes('wait=120'))
  assert.equal(f.run(['test:plan', 'test:gallery']).status, 0)
  assert.ok(f.calls().filter((call) => call.sub === 'run').at(-1).args.includes('wait=60'))
})

test('a serial plan from the environment reaches the laptop and an explicit override wins', (t) => {
  const f = fixture(t)
  const args = ['test:plan', 'test:gallery', '+', 'test:desktop']
  const serial = f.run(args, { JUNO_PLAN_SERIAL: '1' })
  assert.equal(serial.status, 0, serial.output)
  const jobs = f.calls().filter((call) => call.sub === 'run')
  assert.equal(jobs.length, 1)
  assert.ok(jobs[0].args.includes('env=JUNO_PLAN_SERIAL=1'))
  const parallel = f.run(['--env', 'JUNO_PLAN_SERIAL=0', ...args], { JUNO_PLAN_SERIAL: '1' })
  assert.equal(parallel.status, 0, parallel.output)
  assert.equal(f.calls().filter((call) => call.sub === 'run').length, 3)
})

test('--local runs root commands sequentially without requiring tstack or SSH', (t) => {
  const f = fixture(t)
  const result = f.run(['--local', 'test:plan', 'test', 'test/messages.test.ts', '+', 'test:desktop', 'e2e/app.spec.ts'], { TSTACK_HOME: '/nonexistent', TEST_MODE: 'unreachable' })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /local: test test\/messages.test.ts/)
  assert.match(result.output, /local: test:desktop e2e\/app.spec.ts/)
})

test('workers use allocated threads and preserve explicit worker overrides', () => {
  const run = (threads, extra = {}) => {
    const result = spawnSync('bash', ['-uc', 'source "$1" test; printf "%s %s %s" "$JUNO_TEST_WORKERS" "$GALLERY_WORKERS" "$SPECS_JOBS"', '_', resolve('scripts/remote/workers.sh')], { encoding: 'utf8', env: { ...process.env, JUNO_RUNNER_JOB_CORES: threads, JUNO_TEST_WORKERS: '', GALLERY_WORKERS: '', SPECS_JOBS: '', ...extra } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  for (const threads of [1, 2, 4, 6]) {
    for (const workers of run(String(threads)).split(' ').map(Number)) assert.ok(Number.isInteger(workers) && workers > 0 && workers <= threads)
  }
  assert.equal(run('6', { JUNO_TEST_WORKERS: '1', GALLERY_WORKERS: '2', SPECS_JOBS: '1' }), '1 2 1')
})

test('artifacts return to the job directory and failed downloads cannot pass', (t) => {
  const f = fixture(t)
  const report = 'apps/desktop/test-results/result.txt'
  mkdirSync(join(f.dir, 'apps/desktop/test-results'), { recursive: true })
  mkdirSync(join(f.dir, '.remote'))
  writeFileSync(join(f.dir, report), 'test report')
  assert.equal(spawnSync('tar', ['-czf', '.remote/reports.tgz', report], { cwd: f.dir }).status, 0)
  const artifacts = join(f.dir, 'artifacts.tgz')
  assert.equal(spawnSync('tar', ['-czf', artifacts, '.remote/reports.tgz'], { cwd: f.dir }).status, 0)
  const result = f.run(['test', 'test/messages.test.ts'], { TEST_ARTIFACTS: artifacts })
  assert.equal(result.status, 0, result.output)
  const dir = /remote: reports in (.+)\//.exec(result.output)[1]
  assert.equal(readFileSync(join(f.checkout, dir, report), 'utf8'), 'test report')
  const failed = f.run(['test', 'test/messages.test.ts'], { TEST_ARTIFACTS: artifacts, TEST_MODE: 'fetch-failed' })
  assert.equal(failed.status, 255, failed.output)
  assert.match(failed.output, /could not fetch remote reports/)
})

test('usage keeps failures and missing legacy fields visible', () => {
  const legacy = parseRun('bun run test\nremote: CPU busy 50% on average, 45% at the median, over 80 s on 4 cores\nremote: exited with 1\n')
  const current = parseRun('remote: run {"script":"test","machine":"linux/amd64:2x4"}\nremote: summary {"code":0,"warm":false,"machineSeconds":120,"wallSeconds":125}\nremote: script time 90 s\n')
  const output = report([legacy, current])
  assert.match(output, /test \/ unknown \| 1 \(1\) \| 4/)
  assert.match(output, /4\.0 \(1\/1\) \| 100\.0% \(1\/1\)/)
  assert.equal(legacy.wallSeconds, undefined)
  assert.equal(current.scriptSeconds, 90)
})
