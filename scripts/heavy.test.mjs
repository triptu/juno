import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const heavy = fileURLToPath(new URL('./heavy.mjs', import.meta.url))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const launch = (args, env, stdio = 'ignore') => spawn(process.execPath, [heavy, ...args], { env, stdio })
const waitFor = async (condition, timeoutMs = 5000) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await condition()) return
    await wait(50)
  }
  assert.fail('timed out waiting for heavy job state')
}

test('release priority runs before older queued work and does not interrupt holders', async () => {
  const queueName = `order-${process.pid}`
  const env = { ...process.env, JUNO_HEAVY_SLOTS: '2' }
  delete env.JUNO_HEAVY_HELD
  const eventsDir = mkdtempSync(join(tmpdir(), 'juno-heavy-order-'))
  const events = join(eventsDir, 'events')
  const snippet = (name, delay) => `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(events)},${JSON.stringify(name)}+' start\\n');setTimeout(()=>process.exit(0),${delay})`
  const command = (name, delay) => [process.execPath, '-e', snippet(name, delay)]
  const base = ['--queue', queueName]
  const holders = [launch([...base, ...command('holder-a', 1000)], env), launch([...base, ...command('holder-b', 1000)], env)]
  try {
    await waitFor(() => {
      try { return readFileSync(events, 'utf8').includes('holder-a start') && readFileSync(events, 'utf8').includes('holder-b start') } catch { return false }
    })
    const normal = launch([...base, ...command('normal', 10)], env)
    const status = () => {
      const result = spawn(process.execPath, [heavy, ...base, '--status'], { env, stdio: ['ignore', 'pipe', 'ignore'] })
      return new Promise((resolve) => {
        let output = ''
        result.stdout.on('data', (chunk) => { output += chunk })
        result.on('close', () => resolve(output))
      })
    }
    await waitFor(async () => JSON.parse(await status()).queue.some((job) => job.pid === normal.pid))
    const release = launch([...base, '--priority', 'release', ...command('release', 10)], env)
    await waitFor(async () => JSON.parse(await status()).queue.some((job) => job.pid === release.pid))
    await Promise.all([normal, release, ...holders].map((child) => new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`heavy child exited ${code}`)))
    })))
    const starts = readFileSync(events, 'utf8').trim().split('\n')
    assert.ok(starts.indexOf('release start') < starts.indexOf('normal start'), starts.join(', '))
    assert.ok(starts.indexOf('holder-a start') < starts.indexOf('release start'))
    assert.ok(starts.indexOf('holder-b start') < starts.indexOf('release start'))
  } finally {
    for (const child of holders) if (child.exitCode === null) child.kill('SIGTERM')
    rmSync(eventsDir, { recursive: true, force: true })
  }
})

test('a nested heavy request runs inside its parent reservation', async () => {
  const queueName = `nested-${process.pid}`
  const env = { ...process.env, JUNO_HEAVY_SLOTS: '1' }
  delete env.JUNO_HEAVY_HELD
  const result = await new Promise((resolve, reject) => {
    const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,[${JSON.stringify(heavy)},'--queue',${JSON.stringify(queueName)},process.execPath,'-e','process.exit(0)'],{stdio:'inherit'});const timer=setTimeout(()=>{child.kill('SIGKILL');process.exit(9)},1500);child.on('exit',code=>{clearTimeout(timer);process.exit(code)})`
    const outer = launch(['--queue', queueName, '--exclusive', process.execPath, '-e', script], env)
    outer.on('error', reject)
    outer.on('close', (code) => resolve(code))
  })
  assert.equal(result, 0, 'nested request should not wait for its own parent lock')
})
