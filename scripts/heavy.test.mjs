import { toolFixture } from './tool-test-fixture.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const heavy = fileURLToPath(new URL('./heavy.mjs', import.meta.url))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const launch = (args, env, stdio = 'ignore') => {
  const child = spawn(process.execPath, [heavy, ...args], { env, stdio })
  const done = new Promise((resolve) => {
    child.on('error', () => {})
    child.on('close', (code) => resolve(code ?? 1))
  })
  return { child, done }
}
const waitFor = async (condition, timeoutMs = 5000) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await condition()) return
    await wait(50)
  }
  assert.fail('timed out waiting for heavy job state')
}

test('release priority runs before older queued work and does not interrupt holders', { timeout: 10_000 }, async (t) => {
  const { root: eventsDir, env: fixtureEnv } = toolFixture(t)
  const queueName = `order-${process.pid}`
  const env = { ...fixtureEnv, JUNO_HEAVY_SLOTS: '2' }
  delete env.JUNO_HEAVY_HELD
  const events = join(eventsDir, 'events')
  const released = join(eventsDir, 'released')
  const snippet = (name, delay) => `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(events)},${JSON.stringify(name)}+' start\\n');${delay === undefined ? `const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(released)}))clearInterval(timer)},10)` : `setTimeout(()=>process.exit(0),${delay})`}`
  const command = (name, delay) => [process.execPath, '-e', snippet(name, delay)]
  const base = ['--queue', queueName]
  const holders = [launch([...base, ...command('holder-a')], env), launch([...base, ...command('holder-b')], env)]
  const jobs = [...holders]
  try {
    await waitFor(() => {
      try { return readFileSync(events, 'utf8').includes('holder-a start') && readFileSync(events, 'utf8').includes('holder-b start') } catch { return false }
    })
    const normal = launch([...base, ...command('normal', 10)], env)
    jobs.push(normal)
    const status = () => {
      const result = spawn(process.execPath, [heavy, ...base, '--status'], { env, stdio: ['ignore', 'pipe', 'ignore'] })
      return new Promise((resolve) => {
        let output = ''
        result.stdout.on('data', (chunk) => { output += chunk })
        result.on('close', () => resolve(output))
      })
    }
    await waitFor(async () => JSON.parse(await status()).queue.some((job) => job.pid === normal.child.pid))
    const release = launch([...base, '--priority', 'release', ...command('release', 10)], env)
    jobs.push(release)
    await waitFor(async () => JSON.parse(await status()).queue.some((job) => job.pid === release.child.pid))
    writeFileSync(released, '')
    assert.deepEqual(await Promise.all(jobs.map((job) => job.done)), jobs.map(() => 0))
    const starts = readFileSync(events, 'utf8').trim().split('\n')
    assert.ok(starts.indexOf('release start') < starts.indexOf('normal start'), starts.join(', '))
    assert.ok(starts.indexOf('holder-a start') < starts.indexOf('release start'))
    assert.ok(starts.indexOf('holder-b start') < starts.indexOf('release start'))
  } finally {
    for (const { child } of jobs) if (child.exitCode === null) child.kill('SIGTERM')
    await Promise.all(jobs.map((job) => job.done))
  }
})

test('a nested heavy request runs inside its parent reservation', { timeout: 10_000 }, async (t) => {
  const { env: fixtureEnv } = toolFixture(t)
  const queueName = `nested-${process.pid}`
  const env = { ...fixtureEnv, JUNO_HEAVY_SLOTS: '1' }
  delete env.JUNO_HEAVY_HELD
  const result = await new Promise((resolve, reject) => {
    const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,[${JSON.stringify(heavy)},'--queue',${JSON.stringify(queueName)},process.execPath,'-e','process.exit(0)'],{stdio:'inherit'});const timer=setTimeout(()=>{child.kill('SIGKILL');process.exit(9)},1500);child.on('exit',code=>{clearTimeout(timer);process.exit(code)})`
    const outer = launch(['--queue', queueName, '--exclusive', process.execPath, '-e', script], env)
    outer.done.then(resolve, reject)
  })
  assert.equal(result, 0, 'nested request should not wait for its own parent lock')
})

test('Mac app jobs serialize while ordinary jobs retain both slots', { skip: process.platform !== 'darwin' }, async (t) => {
  const { spawn } = await import('node:child_process')
  const { root: dir, env } = toolFixture(t)
  const log = join(dir, 'events')
  delete env.JUNO_HEAVY_HELD
  const children = []
  const run = (name, electron) => new Promise((resolve, reject) => {
    const code = `const fs=require('node:fs'); const event=(kind)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({name:${JSON.stringify(name)},kind,time:Date.now()})+'\\n'); event('start'); setTimeout(()=>event('end'),600)`
    const child = spawn(process.execPath, [heavy, '--queue', `verify-${process.pid}`, ...(electron ? ['--electron'] : []), process.execPath, '-e', code], { env, stdio: 'pipe' })
    children.push(child)
    child.on('error', reject)
    child.on('close', (status) => status === 0 ? resolve() : reject(new Error(`heavy child ${status}`)))
  })
  try {
    await Promise.all([run('app-a', true), run('app-b', true), run('ordinary', false)])
    const events = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    let apps = 0
    let total = 0
    for (const event of events) {
      total += event.kind === 'start' ? 1 : -1
      if (event.name.startsWith('app-')) apps += event.kind === 'start' ? 1 : -1
      assert.ok(apps <= 1)
      assert.ok(total <= 2)
    }
    const start = events.find((event) => event.name === 'ordinary' && event.kind === 'start').time
    assert.ok(events.some((event) => event.name.startsWith('app-') && event.kind === 'start' && Math.abs(event.time - start) < 600), 'an ordinary job can overlap an app job')
  } finally { for (const child of children) if (child.exitCode === null) child.kill('SIGTERM') }
})

test('a ticket left by a dead job whose PID another process now has does not hold the queue', { timeout: 10_000 }, async (t) => {
  const { root, env: fixtureEnv } = toolFixture(t)
  const queueName = `reused-${process.pid}`
  const env = { ...fixtureEnv, JUNO_HEAVY_SLOTS: '1' }
  delete env.JUNO_HEAVY_HELD
  const queueDir = join(env.TMPDIR, `juno-heavy-${queueName}`, 'queue')
  mkdirSync(queueDir, { recursive: true })
  // This test's own PID is alive but never queued: it stands for a reused PID.
  writeFileSync(join(queueDir, `1-0-${process.pid}-left.json`), JSON.stringify({ pid: process.pid, start: 'Thu Jan  1 00:00:00 1970', label: 'left behind', queuedAt: '1970-01-01T00:00:00.000Z', priority: 'normal' }))
  const ran = join(root, 'ran')
  const job = launch(['--queue', queueName, process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(ran)}, '')`], env)
  assert.equal(await job.done, 0)
  assert.ok(existsSync(ran), 'the queued job ran')
})
