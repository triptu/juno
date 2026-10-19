import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runnerHarness } from './runner-test-harness.mjs'
import { runnerContainerLimits, runnerJobSize } from './runner.mjs'

const library = readFileSync(new URL('./runner-capacity.sh', import.meta.url), 'utf8')
const host = readFileSync(new URL('./runner-host.sh', import.meta.url), 'utf8')
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'juno-core-pinning-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const topology = join(dir, 'topology')
  mkdirSync(topology)
  writeFileSync(join(topology, 'online'), '4-11')
  for (let cpu = 4; cpu < 12; cpu++) {
    const path = join(topology, `cpu${cpu}`, 'topology')
    mkdirSync(path, { recursive: true })
    // Unlike the laptop: sibling offset 4; core_id is deliberately sparse.
    writeFileSync(join(path, 'core_id'), String(cpu % 4 + 20))
    writeFileSync(join(path, 'thread_siblings_list'), `${cpu % 4 + 4},${cpu % 4 + 8}`)
  }
  const config = join(dir, '.config/juno-runner/cores')
  mkdirSync(join(config, '..'), { recursive: true })
  writeFileSync(config, '4-7')
  const env = { ...process.env, HOME: dir, PATH: `${dir}:${process.env.PATH}` }
  const script = `${library}\nrunner_capacity "$HOME/.config/juno-runner/cores" "$HOME/topology" || exit 70; `
  const run = (command) => spawnSync('bash', ['-ec', script + command], { env, encoding: 'utf8', timeout: 5000 })
  return { dir, topology, config, env, run }
}

test('cores config accepts quotas and physical lists, maps topology, and rejects invalid or offline cores', (t) => {
  const { run, config, topology } = fixture(t)
  assert.equal(run('echo "$pinned $capacity ${core_cpus[*]}"').stdout.trim(), '1 4 4,8 5,9 6,10 7,11')
  writeFileSync(config, '2')
  assert.equal(run('echo "$pinned $capacity"').stdout.trim(), '0 2')
  writeFileSync(config, '4-4')
  assert.equal(run('echo "$pinned $capacity"').stdout.trim(), '1 1')
  for (const invalid of ['', '0', '7-4', '4-8', '4-5,5', '4,', '04-5', '4-999999999']) {
    writeFileSync(config, invalid)
    assert.equal(run('echo UNEXPECTED').status, 70, invalid)
  }
  writeFileSync(config, '4-7')
  writeFileSync(join(topology, 'online'), '4-10')
  assert.equal(run('echo UNEXPECTED').status, 70)
  // Even with a valid CPU 0, a bare zero is an invalid quota, not a core list.
  mkdirSync(join(topology, 'cpu0/topology'), { recursive: true })
  writeFileSync(join(topology, 'cpu0/topology/thread_siblings_list'), '0')
  writeFileSync(join(topology, 'online'), '0-11')
  writeFileSync(config, '0')
  assert.equal(run('echo UNEXPECTED').status, 70)
})

test('whole-core allocation prefers neighbours, handles fragmentation and reuses released cores', (t) => {
  const { run } = fixture(t)
  for (const [occupied, needed, expected] of [['', 2, '4,5 4,8,5,9 4'], ['5', 2, '6,7 6,10,7,11 4'], ['5,7', 2, '4,6 4,8,6,10 4'], ['4,5', 2, '6,7 6,10,7,11 4']]) {
    const result = run(`runner_allocate '${occupied}' ${needed}; echo "$allocated_cores $allocated_cpus $allocated_threads"`)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), expected)
  }
  assert.notEqual(run("runner_allocate '4,5,6' 2").status, 0)
  assert.equal(run("runner_allocate '' 2; echo $allocated_cores").stdout.trim(), '4,5')
})

test('physical job sizes and Docker limits preserve quota mode and round spec and explicit budgets', () => {
  const size = (script, args = [], extra = {}) => runnerJobSize({ script, args, ...extra }, 8, true)
  for (const script of ['test:desktop', 'test:e2e', 'test:gallery', 'test', 'specs:check']) assert.equal(size(script).reserved, 2)
  assert.equal(size('test', ['test/messages.test.ts']).reserved, 1)
  assert.equal(size('specs:check', [], { specsCached: true }).reserved, 1)
  assert.equal(size('specs:conformance').reserved, 4)
  assert.deepEqual(size('test', [], { explicitMachine: true, machine: 'linux/amd64:3x6' }), { reserved: 2, cpus: 4, wideUnit: true })
  const limits = runnerContainerLimits(size('test:desktop'), true, true)
  for (const arg of ['--cpuset-cpus "$JUNO_RUNNER_CPUSET"', '--cpus "$JUNO_RUNNER_THREADS"', 'JUNO_RUNNER_JOB_CORES="$JUNO_RUNNER_THREADS"', '--memory 6g --memory-swap 6g', '--tmpfs /tmp:rw,exec,nosuid,size=2g,mode=1777', '--tmpfs /work:rw,exec,nosuid,size=2g,mode=1777', '-e TMPDIR=/tmp']) assert.ok(limits.includes(arg), arg)
  assert.match(runnerContainerLimits(size('test', ['test/messages.test.ts']), true, true), /--memory 3g/)
  assert.match(runnerContainerLimits(size('specs:conformance'), true, true), /--memory 12g.*size=4g/)
  assert.doesNotMatch(runnerContainerLimits(size('test:desktop'), true, false), /--tmpfs \/work/)
  assert.equal(runnerContainerLimits({ cpus: 2, wideUnit: false }, false, true), '--cpus 2 -e JUNO_RUNNER_JOB_CORES=2 -e JUNO_RUNNER_WIDE_UNIT=0')
})

const waitFor = async (check) => {
  const deadline = Date.now() + 5000
  while (!check()) {
    assert.ok(Date.now() < deadline, 'host job did not reach expected state')
    await new Promise((done) => setTimeout(done, 20))
  }
}

test('Linux leases free whole cores after normal exit, SIGTERM, SIGKILL and timeout', { skip: process.platform !== 'linux' }, async (t) => {
  const { dir, env } = fixture(t)
  writeFileSync(join(dir, 'docker'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(dir, 'docker'), 0o755)
  // Use the fixture topology but the real flock, timeout and host lifecycle.
  const script = `${library}\n${host.replace('runner_capacity "$HOME/.config/juno-runner/cores"', 'runner_capacity "$HOME/.config/juno-runner/cores" "$HOME/topology"').replace('3h bash', '2s bash')}`
  const start = (name, command, cores = 2) => {
    const child = spawn('bash', ['-c', script, '_', String(cores), name, command, '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output += chunk })
    const done = new Promise((resolvePromise) => child.on('close', (code) => resolvePromise({ code, output })))
    t.after(() => child.kill('SIGKILL'))
    return { child, done }
  }
  const leases = join(dir, '.cache/juno-runner/jobs')
  for (const signal of ['SIGTERM', 'SIGKILL', 'timeout']) {
    const name = signal.toLowerCase()
    const first = start(name, 'echo "$JUNO_RUNNER_CPUSET" > "$HOME/first"; sleep 20', 4)
    await waitFor(() => existsSync(join(dir, 'first')))
    const lease = readFileSync(join(leases, name), 'utf8').trim().split(' ')
    assert.equal(lease[3], '4,5,6,7')
    assert.ok(Number(lease[4]) > 0)
    const busy = await start('busy', 'echo SHOULD_NOT_RUN').done
    assert.equal(busy.code, 75, busy.output)
    if (signal !== 'timeout') first.child.kill(signal)
    // SIGKILL leaves a lease; the next admission must kill its supervisor and reap it.
    if (signal === 'SIGKILL') await new Promise((done) => first.child.once('exit', done))
    else await first.done
    const next = await start('next', 'echo "$JUNO_RUNNER_CPUSET" > "$HOME/next"', 4).done
    assert.equal(next.code, 0, next.output)
    assert.equal(readFileSync(join(dir, 'next'), 'utf8'), '4,8,5,9,6,10,7,11\n')
    assert.deepEqual(readdirSync(leases), [])
    await first.done
    rmSync(join(dir, 'first'))
  }
  const a = start('a', 'echo "$JUNO_RUNNER_CPUSET" > "$HOME/a"; sleep 0.4')
  const b = start('b', 'echo "$JUNO_RUNNER_CPUSET" > "$HOME/b"; sleep 0.4')
  const results = await Promise.all([a.done, b.done])
  for (const result of results) assert.equal(result.code, 0, result.output)
  const cpus = (name) => readFileSync(join(dir, name), 'utf8').trim().split(',')
  assert.equal(cpus('a').filter((cpu) => cpus('b').includes(cpu)).length, 0)
  assert.deepEqual(readdirSync(leases), [])
})


test('split SSH plan jobs each request their own physical-core allocation', () => {
  const { dir, env, calls } = runnerHarness()
  const runs = []
  try {
    const result = spawnSync(process.execPath, ['scripts/remote.mjs', 'test:plan', 'test', '+', 'specs:conformance', '+', 'test:gallery', '+', 'test:desktop'], {
      env: { ...env, TEST_MODE: 'plan', TEST_CAPACITY: '8', TEST_PINNED: '1', JUNO_RUNNER_PLAN: undefined, JUNO_PLAN_SERIAL: undefined }, encoding: 'utf8', timeout: 30000,
    })
    for (const match of (result.stdout + result.stderr).matchAll(/remote: (?:plan )?output in (.+)\/(?:run|plan)\.log/g)) runs.push(match[1])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const reservations = readFileSync(calls, 'utf8').split('\n').filter((line) => line.startsWith('reservation ')).sort()
    assert.deepEqual(reservations, ['reservation 2 cpus 4 job-cores 4', 'reservation 2 cpus 4 job-cores 4', 'reservation 4 cpus 8 job-cores 8'])
  } finally {
    for (const path of runs) rmSync(path, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
