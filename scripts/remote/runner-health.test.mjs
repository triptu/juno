import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkRunner, runnerConfig } from './runner.mjs'

test('.local probes try IPv4 first, keep the working transport and preserve IPv6 and strict failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-runner-health-'))
  const previous = { PATH: process.env.PATH, TEST_HEALTH: process.env.TEST_HEALTH, TEST_CALLS: process.env.TEST_CALLS }
  writeFileSync(join(dir, 'ssh'), `#!/usr/bin/env node
const fs = require('node:fs');
const ipv4 = process.argv.includes('-4');
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({ ipv4 }) + '\\n');
if (process.env.TEST_HEALTH === 'auth') { console.error('Permission denied (publickey)'); process.exit(255); }
if (process.env.TEST_HEALTH === 'broken') { console.log('__juno_runner_connected'); console.error('Docker unavailable'); process.exit(1); }
if (ipv4 !== (process.env.TEST_HEALTH === 'ipv4')) { console.error('connect to host runner.local port 2222: Operation timed out'); process.exit(255); }
console.log('__juno_runner_connected\\njuno-runner-ready 16');
`)
  chmodSync(join(dir, 'ssh'), 0o755)
  try {
    process.env.PATH = `${dir}:${previous.PATH}`
    process.env.TEST_CALLS = join(dir, 'calls')
    for (const mode of ['ipv4', 'ipv6', 'auth', 'broken']) {
      process.env.TEST_HEALTH = mode
      writeFileSync(process.env.TEST_CALLS, '')
      const config = runnerConfig({ HOME: dir, JUNO_RUNNER_HOST: 'user@runner.local' })
      if (mode === 'auth') assert.throws(() => checkRunner(config), /SSH configuration failed/)
      else if (mode === 'broken') assert.throws(() => checkRunner(config), /health check failed/)
      else {
        assert.deepEqual(checkRunner(config), { reachable: true, cores: 16 })
        assert.equal(config.args.includes('-4'), mode === 'ipv4')
      }
      const called = readFileSync(process.env.TEST_CALLS, 'utf8').trim().split('\n').map(JSON.parse)
      assert.deepEqual(called, mode === 'ipv6' ? [{ ipv4: true }, { ipv4: false }] : [{ ipv4: true }])
    }
    process.env.TEST_HEALTH = 'ipv6'
    writeFileSync(process.env.TEST_CALLS, '')
    const ordinary = runnerConfig({ HOME: dir, JUNO_RUNNER_HOST: 'runner.example' })
    assert.equal(checkRunner(ordinary).reachable, true)
    assert.deepEqual(readFileSync(process.env.TEST_CALLS, 'utf8').trim().split('\n').map(JSON.parse), [{ ipv4: false }])
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(dir, { recursive: true, force: true })
  }
})
