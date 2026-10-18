import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

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
writeFileSync(${JSON.stringify(join(poolDir, 'watcher.version'))}, '8');
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
// Past the quick retries a run waits out the outage; JUNO_REMOTE_OUTAGE_WAIT=0 gives up at once.
if (${exhausted}) await assert.rejects(request, (error) => error.outage && /Namespace unreachable since .*nsc create timed out 3 times.*context deadline exceeded/.test(error.message)); else result = await request;
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
        env: { ...process.env, TMPDIR: dir, PATH: `${dir}:${process.env.PATH}`, TEST_INSTANCES: state, TEST_LISTS: counter, JUNO_REMOTE_MAX_VCPU: '2', ...(exhausted ? { JUNO_REMOTE_OUTAGE_AFTER: '5s', JUNO_REMOTE_OUTAGE_WAIT: '0' } : {}) },
        encoding: 'utf8', timeout: 30_000,
      })
      assert.equal(result.status, 0, result.stderr || result.error?.message)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})

test('every script runs on one standard machine; desktop shards only when asked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-shapes-'))
  writeFileSync(join(dir, 'git'), "#!/bin/sh\nprintf 'package.json\\0scripts/remote.mjs\\0scripts/remote/run.sh\\0'\n")
  chmodSync(join(dir, 'git'), 0o755)
  const env = { ...process.env, HOME: dir, PATH: `${dir}:${process.env.PATH}` }
  for (const key of ['JUNO_REMOTE_MACHINE', 'JUNO_REMOTE_DESKTOP_SHARDS', 'JUNO_RUNNER_HOST', 'GALLERY_SHIFT_ONLY']) delete env[key]
  const dryRun = (args) => {
    const result = spawnSync(process.execPath, ['scripts/remote.mjs', '--dry-run', ...args], { env, encoding: 'utf8', timeout: 30_000 })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    return result.stdout
  }
  try {
    for (const args of [['test:e2e'], ['test:desktop'], ['test'], ['--env', 'GALLERY_SHIFT_ONLY=Sidebar', 'test:gallery'], ['test:plan', 'test', '+', 'test:desktop']]) {
      const output = dryRun(args)
      assert.equal(output.match(/a warm linux\/amd64:8x16/g)?.length, 1, args.join(' '))
      assert.doesNotMatch(output, /--shard=/)
    }
    const sharded = dryRun(['--shards', '4', 'test:desktop'])
    assert.equal(sharded.match(/a warm linux\/amd64:8x16/g)?.length, 4)
    for (let shard = 1; shard <= 4; shard++) assert(sharded.includes(`--shard=${shard}/4`))
    assert.match(dryRun(['--machine', 'linux/amd64:4x8', 'test:desktop']), /a warm linux\/amd64:4x8/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('inventory is shared briefly across processes and mutations invalidate it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-inventory-'))
  const counter = join(dir, 'calls')
  const source = join(dir, 'instances')
  writeFileSync(source, 'null')
  writeFileSync(join(dir, 'nsc'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.TEST_CALLS, 'list\\n');
if (process.env.TEST_INVALIDATE) fs.writeFileSync(process.env.TEST_REVISION, require('node:crypto').randomUUID());
console.log(fs.readFileSync(process.env.TEST_INSTANCES, 'utf8'));
`)
  chmodSync(join(dir, 'nsc'), 0o755)
  const invoke = (body) => spawnSync(process.execPath, ['--input-type=module', '-e', `
import { list, invalidateInventory, acquire } from ${JSON.stringify(new URL('./pool.mjs', import.meta.url).href)};
${body}
`], { env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, PATH: `${dir}:${process.env.PATH}`, JUNO_REMOTE_IDLE_MINUTES: '1', TEST_CALLS: counter, TEST_INSTANCES: source, TEST_REVISION: join(dir, 'juno-remote-pool', 'inventory-revision') }, encoding: 'utf8', timeout: 10_000 })
  try {
    assert.equal(invoke('console.log(JSON.stringify(list().instances))').stdout.trim(), '[]')
    assert.equal(invoke('console.log(JSON.stringify(list().instances))').stdout.trim(), '[]')
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 1)
    const reused = invoke(`
import { writeFileSync } from 'node:fs';
const poolDir = ${JSON.stringify(join(dir, 'juno-remote-pool'))};
writeFileSync(poolDir + '/watcher.pid', String(process.pid));
writeFileSync(poolDir + '/watcher.version', '8');
writeFileSync(poolDir + '/new.json', JSON.stringify({ id: 'new', machine: 'linux/amd64:4x8', created: list().startedAt + 1, lastUsed: Date.now() }));
const result = await acquire('linux/amd64:4x8', () => { throw new Error('must reuse the newly recorded machine') }, () => {});
if (!result.warm || result.id !== 'new') throw new Error('lost a machine newer than the cached inventory');
`)
    assert.equal(reused.status, 0, reused.stderr)
    writeFileSync(source, '[{"cluster_id":"new","shape":{"virtual_cpu":4}}]')
    const refreshed = invoke('invalidateInventory(); console.log(JSON.stringify(list().instances))')
    assert.equal(refreshed.status, 0, refreshed.stderr)
    assert.equal(JSON.parse(refreshed.stdout)[0].cluster_id, 'new')
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 2)
    const cachePath = join(dir, 'juno-remote-pool', 'inventory-cache')
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
    writeFileSync(cachePath, JSON.stringify({ ...cached, completedAt: Date.now() - 6000 }))
    writeFileSync(source, '{}')
    const invalid = invoke('list()')
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stderr, /nsc list did not return an array/)
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 3)
    writeFileSync(source, '[]')
    assert.equal(invoke("invalidateInventory(); process.env.TEST_INVALIDATE = '1'; list()").status, 0)
    assert.equal(invoke('list()').status, 0)
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 5)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('idle cleanup precedes a failed inventory and preserves live machines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-reap-idle-'))
  const calls = join(dir, 'calls')
  writeFileSync(join(dir, 'nsc'), '#!/bin/sh\nprintf "%s %s\\n" "$1" "$2" >> "$TEST_CALLS"\n[ "$1" = destroy ]\n')
  chmodSync(join(dir, 'nsc'), 0o755)
  const script = `
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { acquire } from ${JSON.stringify(new URL('./pool.mjs', import.meta.url).href)};
const pool = ${JSON.stringify(join(dir, 'juno-remote-pool'))};
writeFileSync(pool + '/watcher.pid', String(process.pid));
writeFileSync(pool + '/watcher.version', '8');
mkdirSync(pool + '/live.lock');
writeFileSync(pool + '/live.lock/pid', String(process.ppid));
for (const id of ['idle', 'live', 'kept']) writeFileSync(pool + '/' + id + '.json', JSON.stringify({
 id, machine: 'linux/amd64:8x16', created: Date.now() - 120000, lastUsed: Date.now() - 120000, kept: id === 'kept'
}));
await assert.rejects(acquire('linux/amd64:2x4', () => { throw new Error('must not create after inventory failure') }, () => {}), /nsc list failed/);
assert.equal(readFileSync(process.env.TEST_CALLS, 'utf8'), 'destroy idle\\nlist -o\\n');
assert(!existsSync(pool + '/idle.json'));
assert(existsSync(pool + '/live.json'));
assert(existsSync(pool + '/kept.json'));
assert(!existsSync(pool + '/decide.lock'));
`
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, PATH: `${dir}:${process.env.PATH}`, TEST_CALLS: calls, JUNO_REMOTE_IDLE_MINUTES: '1' },
      encoding: 'utf8', timeout: 10_000,
    })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

function writePoolNamespace(dir) {
  writeFileSync(join(dir, 'nsc'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.TEST_INSTANCES;
if (process.argv[2] === 'list') {
 fs.appendFileSync(process.env.TEST_CALLS, process.ppid + '\\n');
 const instances = fs.readdirSync(dir).map(id => JSON.parse(fs.readFileSync(path.join(dir, id))));
 console.log(JSON.stringify(instances.length ? instances : null));
} else if (process.argv[2] === 'destroy') fs.rmSync(path.join(dir, process.argv[3]), { force: true });
else process.exit(2);
`)
  chmodSync(join(dir, 'nsc'), 0o755)
}

async function poolHarness(extraEnv = {}) {
  const { spawn } = await import('node:child_process')
  const { mkdirSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'juno-pool-daemon-'))
  const poolDir = join(dir, 'juno-remote-pool')
  const instances = join(dir, 'instances')
  mkdirSync(instances)
  writePoolNamespace(dir)
  const children = []
  const env = { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, PATH: `${dir}:${process.env.PATH}`, TEST_INSTANCES: instances, TEST_CALLS: join(dir, 'lists'), JUNO_REMOTE_MAX_VCPU: '8', JUNO_REMOTE_IDLE_MINUTES: '0', ...extraEnv }
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 35_000
    while (!predicate()) {
      assert(Date.now() < deadline, `timed out; children: ${children.map((item) => item.output).join('\n')}`)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }
  }
  const run = (name, cores, holdCreate = false) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
import { existsSync, writeFileSync } from 'node:fs';
import { acquire, destroy } from ${JSON.stringify(new URL('./pool.mjs', import.meta.url).href)};
const job = await acquire('linux/amd64:${cores}x${cores * 2}', async (_, labels) => {
 console.log('creating');
 while (${holdCreate} && !existsSync(${JSON.stringify(join(dir, `finish-create-${name}`))})) await new Promise(resolve => setTimeout(resolve, 50));
 writeFileSync(${JSON.stringify(join(instances, name))}, JSON.stringify({ cluster_id: '${name}', shape: { virtual_cpu: ${cores} }, labels: {...labels, 'juno-remote': '1'}, created_at: new Date().toISOString() }));
 return '${name}';
}, console.log);
console.log('acquired');
while (!existsSync(${JSON.stringify(join(dir, `release-${name}`))})) await new Promise(resolve => setTimeout(resolve, 50));
if (!destroy(job.id)) throw new Error('destroy failed');
`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const item = { child, output: '', done: undefined }
    child.stdout.on('data', (chunk) => { item.output += chunk })
    child.stderr.on('data', (chunk) => { item.output += chunk })
    item.done = new Promise((resolvePromise) => child.on('close', resolvePromise))
    children.push(item)
    return item
  }
  return { dir, poolDir, instances, children, waitFor, run }
}

test('daemon owns inventory, holds capacity for a queue head past its hold, and survives a crash through direct admission', { timeout: 60_000 }, async () => {
  const { dir, poolDir, instances, children, waitFor, run } = await poolHarness({ JUNO_REMOTE_HOLD_SECONDS: '0' })
  let daemon
  try {
    const blocker = run('blocker', 2, true)
    await waitFor(() => blocker.output.includes('creating'))
    daemon = Number(readFileSync(join(poolDir, 'watcher.pid'), 'utf8'))
    const head = run('head', 8)
    await waitFor(() => head.output.includes('waiting: 1st'))
    const small = run('small', 2)
    await waitFor(() => small.output.includes('waiting: 2nd'))
    const abandoned = run('abandoned', 2)
    await waitFor(() => abandoned.output.includes('waiting: 3rd'))
    abandoned.child.kill('SIGKILL')
    await abandoned.done
    // At least one daemon tick sees six free cores and must leave them for head.
    await waitFor(() => readFileSync(join(dir, 'lists'), 'utf8').trim().split('\n').length >= 3)
    assert(!head.output.includes('acquired'))
    assert(!small.output.includes('acquired'))
    assert.deepEqual(new Set(readFileSync(join(dir, 'lists'), 'utf8').trim().split('\n')), new Set([String(daemon)]))
    process.kill(daemon, 'SIGKILL')
    await waitFor(() => head.output.includes('using direct admission') || small.output.includes('using direct admission'))
    writeFileSync(join(dir, 'finish-create-blocker'), '')
    await waitFor(() => blocker.output.includes('acquired'))
    writeFileSync(join(dir, 'release-blocker'), '')
    assert.equal(await blocker.done, 0, blocker.output)
    await waitFor(() => head.output.includes('acquired'))
    assert(!small.output.includes('acquired'), small.output)
    writeFileSync(join(dir, 'release-head'), '')
    assert.equal(await head.done, 0, head.output)
    await waitFor(() => small.output.includes('acquired'))
    writeFileSync(join(dir, 'release-small'), '')
    assert.equal(await small.done, 0, small.output)
    assert.deepEqual(readdirSync(instances), [])
    assert.deepEqual(readdirSync(join(poolDir, 'queue')), [])
    assert(!readdirSync(poolDir).some((name) => name.startsWith('pending-')))
  } finally {
    for (const { child } of children) if (child.exitCode === null) child.kill('SIGKILL')
    if (daemon) { try { process.kill(daemon, 'SIGKILL') } catch { /* Already exited. */ } }
    await Promise.all(children.map((item) => item.done))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a waiting request leaves free cores to a later one that fits', { timeout: 60_000 }, async () => {
  const { dir, children, waitFor, run } = await poolHarness()
  try {
    const blocker = run('blocker', 2, true)
    await waitFor(() => blocker.output.includes('creating'))
    const head = run('head', 8)
    await waitFor(() => head.output.includes('waiting: 1st'))
    const small = run('small', 2)
    await waitFor(() => small.output.includes('acquired'))
    assert(!head.output.includes('acquired'))
  } finally {
    for (const { child } of children) if (child.exitCode === null) child.kill('SIGKILL')
    try { process.kill(Number(readFileSync(join(dir, 'juno-remote-pool', 'watcher.pid'), 'utf8')), 'SIGKILL') } catch { /* Already exited. */ }
    await Promise.all(children.map((item) => item.done))
    rmSync(dir, { recursive: true, force: true })
  }
})
