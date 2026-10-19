import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { hostCommand, runnerConfig, runnerJobSize } from './runner.mjs'
import { runnerHarness } from './runner-test-harness.mjs'

function fixture(t) {
  const harness = runnerHarness()
  const reports = new Set()
  t.after(() => { for (const path of reports) rmSync(path, { recursive: true, force: true }); rmSync(harness.dir, { recursive: true, force: true }) })
  return { ...harness, run(args, env = {}) {
    const result = spawnSync(process.execPath, ['scripts/remote.mjs', ...args], { env: { ...harness.env, ...env }, encoding: 'utf8', timeout: 20_000 })
    const output = result.stdout + result.stderr
    for (const match of output.matchAll(/remote: output in (.+)\/(?:run|plan)\.log/g)) reports.add(match[1])
    return { ...result, output }
  }, calls: () => readFileSync(harness.calls, 'utf8').trim().split('\n').map(JSON.parse) }
}

test('workload sizing uses whole cores and rejects an oversized explicit request', () => {
  const size = (script, args = [], extra = {}, capacity = 8) => runnerJobSize({ script, args, ...extra }, capacity)
  for (const script of ['test', 'test:desktop', 'test:gallery', 'test:e2e', 'specs:check']) assert.equal(size(script).reserved, 2)
  for (const script of ['test:agent', 'test:agent-contracts', 'test:agent-testing']) assert.equal(size(script).reserved, 1)
  assert.equal(size('test', ['test/messages.test.ts']).reserved, 1)
  assert.equal(size('specs:check', [], { specsCached: true }).reserved, 1)
  assert.equal(size('specs:check', ['--no-cache'], { specsCached: true }).reserved, 2)
  assert.equal(size('specs:conformance').reserved, 4)
  assert.equal(size('specs:traces').reserved, 4)
  assert.equal(size('specs:conformance', [], {}, 2).reserved, 2)
  assert.throws(() => size('test', [], { cores: 9 }), /runner lends 8/)
  assert.equal(size('test:plan', ['test', '+', 'specs:conformance']).reserved, 4)
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
  assert.equal(JSON.parse(readFileSync(log, 'utf8').match(/^remote: summary (.+)$/m)[1]).threads, 6)
})

test('missing tstack, unreachable hosts and full hosts fail with actionable messages', (t) => {
  const f = fixture(t)
  for (const [env, code, message] of [[{ TSTACK_HOME: '/nonexistent' }, 255, /\/tstack:setup/], [{ TEST_MODE: 'unreachable' }, 255, /runner unreachable.*--local.*heavy lock/], [{ TEST_MODE: 'busy' }, 75, /full past the wait.*--local.*heavy lock/], [{ TEST_MODE: 'lost' }, 255, /lost the connection/]]) {
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

test('split plans reserve unit, app and specs jobs independently and retain original results', (t) => {
  const f = fixture(t)
  const result = f.run(['--wait', '120', 'test:plan', 'test', '+', 'specs:conformance', '+', 'test:gallery', '+', 'test:desktop'])
  assert.equal(result.status, 0, result.output)
  const jobs = f.calls().filter((call) => call.sub === 'run')
  assert.deepEqual(jobs.map((job) => job.args.find((arg) => arg.startsWith('cores='))).sort(), ['cores=2', 'cores=2', 'cores=4'])
  for (const job of jobs) assert.ok(job.args.includes('wait=120'))
  for (const [index, script] of ['test', 'specs:conformance', 'test:gallery', 'test:desktop'].entries()) assert.match(result.output, new RegExp(`plan: step ${index} ${script} exited with 0`))
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
    const result = spawnSync('bash', ['-uc', 'source "$1" test; printf "%s %s %s" "$JUNO_VITEST_WORKERS" "$GALLERY_WORKERS" "$SPECS_JOBS"', '_', resolve('scripts/remote/workers.sh')], { encoding: 'utf8', env: { ...process.env, JUNO_RUNNER_JOB_CORES: threads, JUNO_VITEST_WORKERS: '', GALLERY_WORKERS: '', SPECS_JOBS: '', ...extra } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  assert.equal(run('1'), '1 1 1')
  assert.equal(run('2'), '2 1 1')
  assert.equal(run('6'), '3 4 3')
  assert.equal(run('6', { JUNO_VITEST_WORKERS: '1', GALLERY_WORKERS: '2', SPECS_JOBS: '1' }), '1 2 1')
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
  assert.equal(readFileSync(join(dir, report), 'utf8'), 'test report')
  const failed = f.run(['test', 'test/messages.test.ts'], { TEST_ARTIFACTS: artifacts, TEST_MODE: 'fetch-failed' })
  assert.equal(failed.status, 255, failed.output)
  assert.match(failed.output, /could not fetch remote reports/)
})
