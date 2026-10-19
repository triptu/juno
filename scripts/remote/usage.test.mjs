import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRun, report } from './usage.mjs'

test('usage keeps failures and missing legacy fields visible', () => {
  const legacy = parseRun('pnpm test\nremote: CPU busy 50% on average, 45% at the median, over 80 s on 4 cores\nremote: exited with 1\n')
  const current = parseRun('remote: run {"script":"test","machine":"linux/amd64:2x4"}\nremote: summary {"code":0,"warm":false,"machineSeconds":120,"wallSeconds":125}\nremote: script time 90 s\n')
  const output = report([legacy, current])
  assert.match(output, /test \/ unknown \| 1 \(1\) \| 4/)
  assert.match(output, /4\.0 \(1\/1\) \| 100\.0% \(1\/1\)/)
  assert.equal(legacy.wallSeconds, undefined)
  assert.equal(current.scriptSeconds, 90)
})
test('Mac app jobs serialize while ordinary jobs retain both slots', { skip: process.platform !== 'darwin' }, async () => {
  const { spawn } = await import('node:child_process')
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const dir = mkdtempSync(join(tmpdir(), 'juno-heavy-test-'))
  const log = join(dir, 'events')
  const env = { ...process.env }
  delete env.JUNO_HEAVY_HELD
  const run = (name, electron) => new Promise((resolve, reject) => {
    const code = `const fs=require('node:fs'); const event=(kind)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({name:${JSON.stringify(name)},kind,time:Date.now()})+'\\n'); event('start'); setTimeout(()=>event('end'),600)`
    const child = spawn(process.execPath, [fileURLToPath(new URL('../heavy.mjs', import.meta.url)), '--queue', `verify-${process.pid}`, ...(electron ? ['--electron'] : []), process.execPath, '-e', code], { env, stdio: 'pipe' })
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
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
