import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

// Exercise the public CLI through fake transports, including workspace streaming.
test('SSH runs stream the workspace and failures never allocate Namespace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-runner-cli-'))
  const calls = join(dir, 'calls')
  writeFileSync(join(dir, 'ssh'), `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv.at(-1);
fs.appendFileSync(process.env.TEST_CALLS, 'ssh\\n');
if (process.env.TEST_MODE === 'unreachable') process.exit(255);
if (process.env.TEST_MODE === 'auth') { console.error('Permission denied (publickey)'); process.exit(255); }
if (command.includes('__juno_runner_connected')) {
 if (process.env.TEST_MODE === 'broken') { console.error('Docker unavailable'); process.exit(1); }
 console.log('__juno_runner_connected\\njuno-runner-ready 4');
} else if (command.includes('__juno_remote_exit_')) {
 const marker = command.match(/__juno_remote_exit_[\\w-]+=/)[0];
 let bytes = 0; process.stdin.on('data', chunk => { bytes += chunk.length });
 process.stdin.on('end', () => {
   fs.appendFileSync(process.env.TEST_CALLS, 'workspace ' + bytes + '\\n');
   console.log('__juno_remote_started\\n__juno_remote_ready\\nremote: script time 1 s\\n' + marker + '7');
 });
} else { process.stdin.resume(); }
`)
  writeFileSync(join(dir, 'nsc'), '#!/bin/sh\necho nsc >> "$TEST_CALLS"\nexit 87\n')
  writeFileSync(join(dir, 'git'), "#!/bin/sh\nprintf 'package.json\\0scripts/remote.mjs\\0scripts/remote/run.sh\\0'\n")
  chmodSync(join(dir, 'git'), 0o755)
  chmodSync(join(dir, 'ssh'), 0o755)
  chmodSync(join(dir, 'nsc'), 0o755)
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_CALLS: calls, JUNO_RUNNER_HOST: 'runner-test', JUNO_RUNNER_IMAGE: 'test/image:tag', JUNO_REMOTE_MAX_VCPU: '0' }
  const runs = []
  try {
    for (const mode of ['unreachable', 'auth', 'broken', 'healthy']) {
      const child = spawnSync(process.execPath, ['scripts/remote.mjs', 'test:agent-contracts'], { cwd: resolve('.'), env: { ...env, TEST_MODE: mode }, encoding: 'utf8', timeout: 30_000 })
      const path = /remote: output in (.+)\/run.log/.exec(child.stderr)?.[1]
      if (path) runs.push(path)
      assert.equal(child.status, mode === 'healthy' ? 7 : 255, child.stderr)
      if (mode === 'unreachable') assert.match(child.stderr, /Namespace is disabled/)
      if (mode === 'auth') assert.match(child.stderr, /runner SSH configuration failed/)
      if (mode === 'broken') assert.match(child.stderr, /runner health check failed/)
      if (mode === 'healthy') {
        assert.match(child.stdout, /script time 1 s/)
        assert.match(readFileSync(join(path, 'run.log'), 'utf8'), /"backend":"ssh"/)
      }
    }
    const called = readFileSync(calls, 'utf8')
    assert.doesNotMatch(called, /nsc/)
    assert.match(called, /workspace [1-9]\d*/)
  } finally {
    for (const path of runs) rmSync(path, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Linux host queue preserves stdin and bounds concurrent core reservations', { skip: process.platform !== 'linux' }, async () => {
  const { spawn } = await import('node:child_process')
  const { mkdirSync } = await import('node:fs')
  const { runnerCommand } = await import('./runner.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'juno-host-queue-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  mkdirSync(join(dir, '.config/juno-runner'), { recursive: true })
  writeFileSync(join(dir, '.config/juno-runner/cores'), '2\n')
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(bin, 'docker'), 0o755)
  const log = join(dir, 'events')
  const run = (id, cores) => new Promise((resolvePromise, reject) => {
    const command = `cat > '${dir}/input-${id}'; echo '${id} ${cores} start' >> '${log}'; sleep 0.2; echo '${id} ${cores} end' >> '${log}'`
    const child = spawn('bash', ['-c', runnerCommand(cores, id, command)], { env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}` }, stdio: ['pipe', 'pipe', 'pipe'] })
    let errors = ''
    child.stderr.on('data', (chunk) => { errors += chunk })
    child.stdin.end(`workspace-${id}`)
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolvePromise() : reject(new Error(errors)))
  })
  try {
    await Promise.all([run('a', 1), run('b', 1), run('c', 2)])
    let used = 0
    for (const line of readFileSync(log, 'utf8').trim().split('\n')) {
      const [, cores, event] = line.split(' ')
      used += Number(cores) * (event === 'start' ? 1 : -1)
      assert.ok(used <= 2 && used >= 0)
    }
    assert.equal(used, 0)
    for (const id of ['a', 'b', 'c']) assert.equal(readFileSync(join(dir, `input-${id}`), 'utf8'), `workspace-${id}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('watcher upgrade never signals an unrelated process with a reused PID', async () => {
  const { spawn } = await import('node:child_process')
  const { mkdirSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'juno-watcher-upgrade-'))
  const state = join(dir, 'juno-remote-pool')
  mkdirSync(state)
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  writeFileSync(join(state, 'watcher.pid'), String(unrelated.pid))
  writeFileSync(join(dir, 'nsc'), '#!/bin/sh\nif [ "$1" = list ]; then echo "[]"; fi\n')
  chmodSync(join(dir, 'nsc'), 0o755)
  const pool = new URL('./pool.mjs', import.meta.url).href
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { acquire, destroy } from ${JSON.stringify(pool)}; const job = await acquire('linux/amd64:2x4', async () => 'fake-upgrade-machine', () => {}); if (!destroy(job.id)) process.exitCode=1`], {
      env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, PATH: `${dir}:${process.env.PATH}`, JUNO_REMOTE_MAX_VCPU: '24' }, encoding: 'utf8', timeout: 10_000,
    })
    assert.equal(child.status, 0, child.stderr)
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0))
  } finally { unrelated.kill(); rmSync(dir, { recursive: true, force: true }) }
})

test('pool retries inventory failures and reclaims timed-out creates before retrying', () => {
  for (const [knownId, exhausted, failedDestroy] of [[false, false, false], [true, false, false], [true, true, false], [true, false, true]]) {
    const dir = mkdtempSync(join(tmpdir(), 'juno-pool-retry-'))
    const poolDir = join(dir, 'juno-remote-pool')
    const state = join(dir, 'instances.json')
    const counter = join(dir, 'lists')
    const executable = join(dir, 'nsc')
    writeFileSync(state, '[]')
    writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.TEST_INSTANCES;
if (process.argv[2] === 'list') {
 const count = fs.existsSync(process.env.TEST_LISTS) ? Number(fs.readFileSync(process.env.TEST_LISTS)) : 0;
 fs.writeFileSync(process.env.TEST_LISTS, String(count + 1));
 if (count < 3) { console.error(count ? 'Unavailable' : 'spawnSync nsc ETIMEDOUT'); process.exit(1); }
 const instances = JSON.parse(fs.readFileSync(file, 'utf8'));
 console.log(JSON.stringify(instances.length ? instances : null));
} else if (process.argv[2] === 'destroy') {
 if (${failedDestroy} && !fs.existsSync(file + '.destroy')) { fs.writeFileSync(file + '.destroy', '1'); console.error('context deadline exceeded'); process.exit(1); }
 fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file)).filter(x => x.cluster_id !== process.argv[3])));
} else process.exit(2);
`)
    chmodSync(executable, 0o755)
    const script = `
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { acquire, destroy } from ${JSON.stringify(new URL('./pool.mjs', import.meta.url).href)};
mkdirSync(${JSON.stringify(poolDir)}, { recursive: true });
writeFileSync(${JSON.stringify(join(poolDir, 'watcher.pid'))}, String(process.pid));
writeFileSync(${JSON.stringify(join(poolDir, 'watcher.version'))}, '5');
let attempts = 0;
const logs = [];
const request = acquire('linux/amd64:2x4', async (_, labels) => {
 attempts++;
 const id = attempts === 1 ? 'partial' : 'ready';
 writeFileSync(process.env.TEST_INSTANCES, JSON.stringify([{cluster_id:id,shape:{virtual_cpu:2},labels:{...labels,'juno-remote':'1'},created_at:new Date().toISOString()}]));
 if (attempts === 1 || ${exhausted}) { const e = new Error('Creating Environment: context deadline exceeded'); if (${knownId}) e.instanceId = id; throw e; }
 return id;
}, message => logs.push(message));
let result;
if (${exhausted}) await assert.rejects(request, /context deadline exceeded/); else result = await request;
assert.equal(attempts, ${exhausted ? 3 : 2});
if (result) assert.equal(result.id, 'ready');
assert(logs.some(x => x.includes('inventory unavailable')));
assert(logs.some(x => x.includes('create timed out')));
if (result) assert(destroy(result.id));
assert.deepEqual(JSON.parse(readFileSync(process.env.TEST_INSTANCES)), []);
assert(!readdirSync(${JSON.stringify(poolDir)}).some(x => x.startsWith('pending-')));
`
    try {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, TMPDIR: dir, PATH: `${dir}:${process.env.PATH}`, TEST_INSTANCES: state, TEST_LISTS: counter, JUNO_REMOTE_MAX_VCPU: '2' },
        encoding: 'utf8', timeout: 30_000,
      })
      assert.equal(result.status, 0, result.stderr || result.error?.message)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})
