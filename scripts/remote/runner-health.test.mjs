import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { toolFixture } from '../tool-test-fixture.mjs'

test('.local probes try IPv4 first, keep the working transport and preserve IPv6 and strict failures', (t) => {
  const { root: dir, env } = toolFixture(t)
  mkdirSync(join(dir, 'scripts/runner'), { recursive: true })
  writeFileSync(join(dir, 'scripts/runner/host.sh'), '# fixture host interface\n')
  writeFileSync(join(dir, 'ssh'), `#!/usr/bin/env node
const fs = require('node:fs');
const ipv4 = process.argv.includes('-4');
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({ ipv4 }) + '\\n');
if (process.env.TEST_HEALTH === 'auth') { console.error('Permission denied (publickey)'); process.exit(255); }
if (process.env.TEST_HEALTH === 'broken') { console.log('__juno_runner_connected'); console.error('Docker unavailable'); process.exit(1); }
if (ipv4 !== (process.env.TEST_HEALTH === 'ipv4')) { console.error('connect to host runner.local port 2222: Operation timed out'); process.exit(255); }
console.log('__juno_runner_connected\\nos=Linux test\\narch=x86_64\\ndocker=28\\ncapacity=16 quota');
`)
  chmodSync(join(dir, 'ssh'), 0o755)
  const calls = join(dir, 'calls')
  const probe = (mode, host) => {
    writeFileSync(calls, '')
    return spawnSync(process.execPath, ['-e', `import {checkRunner, runnerConfig} from ${JSON.stringify(join(import.meta.dirname, 'runner.mjs'))};
const config = runnerConfig(); const health = checkRunner(config); console.log(JSON.stringify({health, ipv4: config.args.includes('-4')}));`], {
      env: { ...env, TSTACK_HOME: dir, PATH: `${dir}:${env.PATH}`, TEST_CALLS: calls, TEST_HEALTH: mode, JUNO_RUNNER_HOST: host }, encoding: 'utf8', timeout: 5000,
    })
  }
  for (const mode of ['ipv4', 'ipv6', 'auth', 'broken']) {
    const result = probe(mode, 'user@runner.local')
    if (mode === 'auth' || mode === 'broken') {
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, mode === 'auth' ? /SSH configuration failed/ : /health check failed/)
    } else {
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout), { health: { reachable: true, cores: 16, pinned: false }, ipv4: mode === 'ipv4' })
    }
    assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse), mode === 'ipv6' ? [{ ipv4: true }, { ipv4: false }] : [{ ipv4: true }])
  }
  assert.equal(probe('ipv6', 'runner.example').status, 0)
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse), [{ ipv4: false }])
})
