import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Namespace outages against a fake nsc that hangs, answers 504 or works; no real machines.
/** A fake nsc whose list hangs, answers 504, or works, by the word in $TEST_MODE. */
function writeOutageNamespace(dir) {
  writeFileSync(join(dir, 'nsc'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.TEST_INSTANCES;
const mode = fs.readFileSync(process.env.TEST_MODE, 'utf8').trim();
if (process.argv[2] === 'list') {
 if (mode === 'hang') setTimeout(() => {}, 60_000);
 else if (mode === '504') { console.error('Error: EnsureKubernetesCluster: 504 Gateway Timeout'); process.exit(1); }
 else {
  const instances = fs.readdirSync(dir).map(id => JSON.parse(fs.readFileSync(path.join(dir, id))));
  console.log(JSON.stringify(instances.length ? instances : null));
 }
} else if (process.argv[2] === 'destroy') {
 fs.appendFileSync(process.env.TEST_DESTROYED, process.argv[3] + '\\n');
 fs.rmSync(path.join(dir, process.argv[3]), { force: true });
} else process.exit(2);
`)
  chmodSync(join(dir, 'nsc'), 0o755)
}

async function outageHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'juno-pool-outage-'))
  const poolDir = join(dir, 'juno-remote-pool')
  const instances = join(dir, 'instances')
  mkdirSync(instances)
  writeFileSync(join(dir, 'mode'), 'ok')
  writeOutageNamespace(dir)
  const children = []
  const env = { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, PATH: `${dir}:${process.env.PATH}`, TEST_INSTANCES: instances, TEST_MODE: join(dir, 'mode'), TEST_DESTROYED: join(dir, 'destroyed'), JUNO_REMOTE_MAX_VCPU: '8', JUNO_REMOTE_IDLE_MINUTES: '0', JUNO_REMOTE_LIST_TIMEOUT_SECONDS: '1', JUNO_REMOTE_OUTAGE_AFTER: '1s' }
  delete env.JUNO_REMOTE_OUTAGE_WAIT
  const waitFor = async (predicate, ms = 40_000) => {
    const deadline = Date.now() + ms
    while (!predicate()) {
      assert(Date.now() < deadline, `timed out; children: ${children.map((item) => item.output).join('\n---\n')}`)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    }
  }
  /** A client that creates `name`; `create` is the body of its create callback. */
  const run = (name, extraEnv = {}, create = `writeFileSync(${JSON.stringify(join(instances, name))}, JSON.stringify({ cluster_id: '${name}', shape: { virtual_cpu: 2 }, labels: { ...labels, 'juno-remote': '1' }, created_at: new Date().toISOString() })); return '${name}';`) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
import { existsSync, writeFileSync } from 'node:fs';
import { acquire, destroy } from ${JSON.stringify(new URL('./pool.mjs', import.meta.url).href)};
let attempts = 0;
let job;
try {
 job = await acquire('linux/amd64:2x4', async (_, labels) => { attempts++; ${create} }, console.log);
} catch (error) { console.log(error.outage ? 'outage: ' + error.message : 'error: ' + error.message); process.exit(error.outage ? 75 : 1); }
console.log('acquired ' + job.id);
while (!existsSync(${JSON.stringify(join(dir, `release-${name}`))})) await new Promise(resolve => setTimeout(resolve, 50));
if (!destroy(job.id)) throw new Error('destroy failed');
`], { env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] })
    const item = { child, output: '', done: undefined }
    child.stdout.on('data', (chunk) => { item.output += chunk })
    child.stderr.on('data', (chunk) => { item.output += chunk })
    item.done = new Promise((resolvePromise) => child.on('close', resolvePromise))
    children.push(item)
    return item
  }
  const daemonPid = () => { try { return Number(readFileSync(join(poolDir, 'watcher.pid'), 'utf8')) } catch { return undefined } }
  const cleanup = async () => {
    for (const { child } of children) if (child.exitCode === null) child.kill('SIGKILL')
    try { process.kill(daemonPid(), 'SIGKILL') } catch { /* Already exited. */ }
    await Promise.all(children.map((item) => item.done))
    rmSync(dir, { recursive: true, force: true })
  }
  return { dir, poolDir, instances, run, waitFor, daemonPid, cleanup }
}

test('a hung Namespace list is reported to every waiting client; one gives up with exit 75, the other runs once it answers', { timeout: 90_000 }, async () => {
  const { dir, poolDir, instances, run, waitFor, daemonPid, cleanup } = await outageHarness()
  try {
    writeFileSync(join(dir, 'mode'), 'hang')
    const patient = run('patient')
    await waitFor(() => existsSync(join(poolDir, 'watcher.script')))
    // The shared daemon runs from a copy in the pool folder, never from a worktree.
    const script = readFileSync(join(poolDir, 'watcher.script'), 'utf8')
    assert(script.startsWith(join(poolDir, 'daemon')), script)
    assert.match(spawnSync('ps', ['-p', String(daemonPid()), '-o', 'args='], { encoding: 'utf8' }).stdout, /daemon\/[0-9a-f]+\/pool\.mjs --watch/)
    const hasty = run('hasty', { JUNO_REMOTE_OUTAGE_WAIT: '2s' })
    assert.equal(await hasty.done, 75, hasty.output)
    assert.match(hasty.output, /outage: Namespace unreachable since \d\d:\d\d \(nsc list timed out \d+ times; last: .*ETIMEDOUT.*\)\. Gave up after .* of outage \(JUNO_REMOTE_OUTAGE_WAIT=2s\); use --local/)
    await waitFor(() => patient.output.includes('Namespace unreachable since'))
    assert.match(patient.output, /Namespace unreachable since \d\d:\d\d \(nsc list timed out \d+ times; last: [^\n]+\)\. Waiting; use --local to run on this Mac\./)
    assert.equal(patient.output.match(/Namespace unreachable since/g).length, 1, patient.output)
    // Waiting through the outage replaces the queue position lines.
    const before = patient.output.length
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 11_000))
    assert.doesNotMatch(patient.output.slice(before), /waiting: 1st in queue/)
    // A 504 counts as failure, not as an answer.
    writeFileSync(join(dir, 'mode'), '504')
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 7000))
    assert(!patient.output.includes('acquired'), patient.output)
    writeFileSync(join(dir, 'mode'), 'ok')
    await waitFor(() => patient.output.includes('acquired patient'))
    assert(!existsSync(join(poolDir, 'namespace-outage')))
    writeFileSync(join(dir, 'release-patient'), '')
    assert.equal(await patient.done, 0, patient.output)
    assert.deepEqual(readdirSync(instances), [])
  } finally { await cleanup() }
})

test('a create that answers 504 but makes its machine later is destroyed, never kept twice', { timeout: 90_000 }, async () => {
  const { dir, poolDir, instances, run, waitFor, cleanup } = await outageHarness()
  const ghost = join(instances, 'ghost')
  try {
    const client = run('real', {}, `
 if (attempts === 1) {
  // Namespace reports a gateway timeout, then the machine appears anyway.
  setTimeout(() => writeFileSync(${JSON.stringify(ghost)}, JSON.stringify({ cluster_id: 'ghost', shape: { virtual_cpu: 2 }, labels: { ...labels, 'juno-remote': '1' }, created_at: new Date().toISOString() })), 1500);
  throw new Error('nsc create failed:\\nEnsureKubernetesCluster: 504 Gateway Timeout');
 }
 writeFileSync(${JSON.stringify(join(instances, 'real'))}, JSON.stringify({ cluster_id: 'real', shape: { virtual_cpu: 2 }, labels: { ...labels, 'juno-remote': '1' }, created_at: new Date().toISOString() }));
 return 'real';`)
    await waitFor(() => client.output.includes('acquired real'))
    assert.match(client.output, /create timed out; reclaiming attempt and retrying \(1\/2\)/)
    // The failed attempt keeps its record and label until the late machine has been seen and destroyed.
    await waitFor(() => existsSync(join(dir, 'destroyed')) && readFileSync(join(dir, 'destroyed'), 'utf8').split('\n').includes('ghost'))
    assert(!existsSync(ghost))
    await waitFor(() => !readdirSync(poolDir).some((name) => name.startsWith('pending-')))
    assert.deepEqual(readdirSync(instances), ['real'])
    assert(existsSync(join(poolDir, 'real.json')))
    writeFileSync(join(dir, 'release-real'), '')
    assert.equal(await client.done, 0, client.output)
    assert.deepEqual(readdirSync(instances), [])
  } finally { await cleanup() }
})

test('a daemon whose script was deleted is replaced by one running from the pool folder', { timeout: 60_000 }, async () => {
  const { dir, poolDir, run, waitFor, daemonPid, cleanup } = await outageHarness()
  const gone = join(dir, 'checkout', 'scripts', 'remote')
  const ready = join(dir, 'stale-ready')
  mkdirSync(gone, { recursive: true })
  writeFileSync(join(gone, 'pool.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(ready)}, ''); setInterval(() => {}, 1000)\n`)
  const stale = spawn(process.execPath, [join(gone, 'pool.mjs'), '--watch'], { stdio: 'ignore' })
  const staleExit = new Promise((resolvePromise) => stale.on('exit', resolvePromise))
  try {
    await waitFor(() => existsSync(ready))
    mkdirSync(poolDir, { recursive: true })
    writeFileSync(join(poolDir, 'watcher.pid'), String(stale.pid))
    writeFileSync(join(poolDir, 'watcher.version'), '12')
    writeFileSync(join(poolDir, 'watcher.script'), join(gone, 'pool.mjs'))
    rmSync(join(dir, 'checkout'), { recursive: true, force: true })
    const client = run('fresh')
    await staleExit
    await waitFor(() => client.output.includes('acquired fresh'))
    await waitFor(() => daemonPid() > 0 && daemonPid() !== stale.pid)
    assert.notEqual(daemonPid(), stale.pid)
    assert(readFileSync(join(poolDir, 'watcher.script'), 'utf8').startsWith(join(poolDir, 'daemon')))
    assert(existsSync(readFileSync(join(poolDir, 'watcher.script'), 'utf8')))
    writeFileSync(join(dir, 'release-fresh'), '')
    assert.equal(await client.done, 0, client.output)
  } finally {
    if (stale.exitCode === null) stale.kill('SIGKILL')
    await cleanup()
  }
})
