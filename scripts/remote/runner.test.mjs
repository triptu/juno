import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { runnerConfig, runnerCommand } from './runner.mjs'
import { imageTag } from './image.mjs'

test('runner settings load from the machine file, with environment values taking precedence', () => {
  const home = mkdtempSync(join(tmpdir(), 'juno-runner-config-'))
  const path = join(home, '.config/juno/runner.json')
  const env = { HOME: home }
  try {
    assert.equal(runnerConfig(env), undefined)
    mkdirSync(join(home, '.config/juno'), { recursive: true })
    writeFileSync(path, JSON.stringify({ host: 'file-runner', port: 2222, key: '~/.ssh/file-key' }))
    const config = runnerConfig(env)
    assert.equal(config.host, 'file-runner')
    assert.deepEqual(config.args.slice(-7), ['-i', join(home, '.ssh/file-key'), '-o', 'IdentitiesOnly=yes', '-p', '2222', 'file-runner'])
    assert.equal(config.image, `juno-remote:${imageTag()}`)
    assert.equal(config.build, true)
    const override = runnerConfig({ ...env, JUNO_RUNNER_HOST: 'env-runner', JUNO_RUNNER_PORT: '2200', JUNO_RUNNER_KEY: '/env key', JUNO_RUNNER_IMAGE: 'registry/image:tag' })
    assert.equal(override.host, 'env-runner')
    assert.deepEqual(override.args.slice(-7), ['-i', '/env key', '-o', 'IdentitiesOnly=yes', '-p', '2200', 'env-runner'])
    assert.equal(override.image, 'registry/image:tag')
    assert.equal(override.build, false)
    assert.throws(() => runnerConfig({ ...env, JUNO_RUNNER_IMAGE: 'image; touch /tmp/bad' }))
    assert.equal(runnerConfig({ ...env, JUNO_RUNNER_HOST: '' }), undefined)
    for (const value of [{ host: '-option' }, { host: 'runner', port: 0 }, { host: 'runner', key: 42 }, null]) {
      writeFileSync(path, JSON.stringify(value))
      assert.throws(() => runnerConfig(env))
    }
    writeFileSync(path, '{')
    assert.throws(() => runnerConfig(env), /Cannot read/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('runner reservations wait 60 seconds, or indefinitely when Namespace is disabled', () => {
  assert.match(runnerCommand(2, 'test', 'cat', {}), /'cat' 60$/)
  assert.match(runnerCommand(2, 'test', 'cat', { JUNO_REMOTE_MAX_VCPU: '0' }), /'cat' -1$/)
})

// Exercise the public CLI through fake transports, including workspace streaming.
function runnerHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'juno-runner-cli-'))
  const calls = join(dir, 'calls')
  writeFileSync(join(dir, 'ssh'), `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv.at(-1);
fs.appendFileSync(process.env.TEST_CALLS, 'ssh\\n');
if (process.env.TEST_MODE === 'unreachable') process.exit(255);
if (process.env.TEST_MODE === 'auth') { console.error('Permission denied (publickey)'); process.exit(255); }
if (command.includes('docker build')) {
 if (process.env.TEST_MODE === 'build-failed') { console.error('Docker build failed'); process.exit(1); }
 let bytes = 0; process.stdin.on('data', chunk => bytes += chunk.length);
 process.stdin.on('end', () => { fs.appendFileSync(process.env.TEST_CALLS, 'build ' + bytes + '\\n'); console.error('#1 DONE 0.1s'); });
} else if (command.includes('__juno_runner_connected')) {
 if (process.env.TEST_MODE === 'broken') { console.error('Docker unavailable'); process.exit(1); }
 console.log('__juno_runner_connected\\njuno-runner-ready 4');
} else if (command.includes('__juno_remote_exit_')) {
 if (process.env.TEST_MODE === 'busy') { console.log('__juno_remote_started\\n__juno_remote_busy\\n__juno_remote_released'); process.exit(75); }
 const marker = command.match(/__juno_remote_exit_[\\w-]+=/)[0];
 let bytes = 0; process.stdin.on('data', chunk => { bytes += chunk.length });
 process.stdin.on('end', () => {
   fs.appendFileSync(process.env.TEST_CALLS, 'workspace ' + bytes + '\\n');
   console.log('__juno_remote_started\\n__juno_remote_ready\\nremote: script time 1 s\\n' + marker + '7');
 });
} else if (command.includes('docker image inspect')) {
 if (command.includes('__juno_image_present')) console.log('__juno_image_missing');
 else if (['build', 'build-failed'].includes(process.env.TEST_MODE)) process.exit(1);
} else { process.stdin.resume(); }
`)
  writeFileSync(join(dir, 'nsc'), '#!/bin/sh\necho nsc >> "$TEST_CALLS"\necho not-json\n')
  writeFileSync(join(dir, 'git'), "#!/bin/sh\nprintf 'package.json\\0scripts/remote.mjs\\0scripts/remote/run.sh\\0'\n")
  chmodSync(join(dir, 'git'), 0o755)
  chmodSync(join(dir, 'ssh'), 0o755)
  chmodSync(join(dir, 'nsc'), 0o755)
  const env = { ...process.env, HOME: dir, TMPDIR: dir, TMP: dir, TEMP: dir, PATH: `${dir}:${process.env.PATH}`, TEST_CALLS: calls, JUNO_RUNNER_HOST: 'runner-test', JUNO_RUNNER_IMAGE: 'test/image:tag', JUNO_REMOTE_MAX_VCPU: '0' }
  return { dir, calls, env }
}

test('SSH runs stream the workspace and failures never allocate Namespace', () => {
  const { dir, calls, env } = runnerHarness()
  const runs = []
  try {
    for (const mode of ['unreachable', 'auth', 'broken', 'healthy', 'build', 'build-failed', 'busy']) {
      const child = spawnSync(process.execPath, ['scripts/remote.mjs', 'test:agent-contracts'], { cwd: resolve('.'), env: { ...env, TEST_MODE: mode, ...(mode.startsWith('build') ? { JUNO_RUNNER_IMAGE: '' } : {}) }, encoding: 'utf8', timeout: 30_000 })
      const path = /remote: output in (.+)\/run.log/.exec(child.stderr)?.[1]
      if (path) runs.push(path)
      assert.equal(child.status, ['healthy', 'build'].includes(mode) ? 7 : 255, child.stderr)
      if (mode === 'unreachable') assert.match(child.stderr, /Namespace is disabled/)
      if (mode === 'auth') assert.match(child.stderr, /runner SSH configuration failed/)
      if (mode === 'broken') assert.match(child.stderr, /runner health check failed/)
      if (mode === 'build-failed') assert.match(child.stderr, /runner image build failed/)
      if (mode === 'healthy') {
        assert.match(child.stdout, /script time 1 s/)
        assert.match(readFileSync(join(path, 'run.log'), 'utf8'), /"backend":"ssh"/)
      }
    }
    const called = readFileSync(calls, 'utf8')
    assert.doesNotMatch(called, /nsc/)
    assert.match(called, /workspace [1-9]\d*/)
    assert.match(called, /build [1-9]\d*/)
    mkdirSync(join(dir, '.config/juno'), { recursive: true })
    writeFileSync(join(dir, '.config/juno/runner.json'), JSON.stringify({ host: 'file-runner', port: 2222, key: '~/.ssh/test' }))
    const fileEnv = { ...env, TEST_MODE: 'healthy' }
    for (const key of ['JUNO_RUNNER_HOST', 'JUNO_RUNNER_PORT', 'JUNO_RUNNER_KEY', 'JUNO_RUNNER_IMAGE']) delete fileEnv[key]
    const plan = spawnSync(process.execPath, ['scripts/remote.mjs', 'test:plan', 'test:agent-contracts'], { env: fileEnv, encoding: 'utf8', timeout: 30_000 })
    const planPath = /remote: output in (.+)\/run.log/.exec(plan.stderr)?.[1]
    if (planPath) runs.push(planPath)
    assert.equal(plan.status, 7, plan.stderr)
    assert.match(plan.stderr, /SSH runner .*running pnpm test:plan/)
    assert.doesNotMatch(readFileSync(calls, 'utf8'), /nsc/)
    assert(!existsSync(join(dir, 'juno-remote-pool/watcher.pid')))
    assert(!existsSync(join(dir, 'juno-remote-pool/daemon')))
    for (const mode of ['busy', 'unreachable']) {
      const child = spawnSync(process.execPath, ['scripts/remote.mjs', 'test:agent-contracts'], { env: { ...env, TEST_MODE: mode, JUNO_REMOTE_MAX_VCPU: '48' }, encoding: 'utf8', timeout: 30_000 })
      const path = /remote: output in (.+)\/run.log/.exec(child.stderr)?.[1]
      if (path) runs.push(path)
      assert.equal(child.status, 255, child.stderr)
      assert.match(child.stderr, mode === 'busy' ? /runner full for 60 s, trying Namespace/ : /runner unreachable, trying Namespace/)
      assert.match(readFileSync(calls, 'utf8'), /nsc/)
      writeFileSync(calls, '')
    }
    const check = spawnSync(process.execPath, ['scripts/remote/runner.mjs'], { env: { ...env, JUNO_RUNNER_IMAGE: '' }, encoding: 'utf8', timeout: 30_000 })
    assert.equal(check.status, 0, check.stderr)
    assert.match(check.stdout, /missing; will be built on first use/)
    const override = spawnSync(process.execPath, ['scripts/remote/runner.mjs'], { env, encoding: 'utf8', timeout: 30_000 })
    assert.notEqual(override.status, 0)
    assert.match(override.stderr, /override image unavailable/)
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

test('concurrent Linux clients build one local tag from the shared context', { skip: process.platform !== 'linux' }, async () => {
  const { spawn } = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'juno-host-build-'))
  writeFileSync(join(dir, 'ssh'), '#!/bin/sh\nfor command; do :; done\nexec bash -c "$command"\n')
  writeFileSync(join(dir, 'docker'), `#!/bin/sh
if [ "$1 $2" = 'image inspect' ]; then test -f "$HOME/present"
elif [ "$1" = build ]; then
 tar -tzf - > "$HOME/context"
 echo build >> "$HOME/builds"
 sleep 0.2
 touch "$HOME/present"
else exit 2
fi
`)
  writeFileSync(join(dir, 'git'), '#!/bin/sh\nprintf \'package.json\\npackages/agent-contract/package.json\\n\'\n')
  for (const name of ['ssh', 'docker', 'git']) chmodSync(join(dir, name), 0o755)
  const run = () => new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
import { ensureRunnerImage } from ${JSON.stringify(new URL('./runner.mjs', import.meta.url).href)};
await ensureRunnerImage({ args: ['host'], image: 'juno-remote:test', build: true });
`], { env: { ...process.env, HOME: dir, PATH: `${dir}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] })
    let errors = ''
    child.stderr.on('data', (chunk) => { errors += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolvePromise() : reject(new Error(errors)))
  })
  try {
    await Promise.all([run(), run()])
    assert.equal(readFileSync(join(dir, 'builds'), 'utf8'), 'build\n')
    const files = readFileSync(join(dir, 'context'), 'utf8')
    for (const file of ['Dockerfile', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'packages/agent-contract/package.json']) assert(files.includes(file), file)
    assert.doesNotMatch(files, /runner\.mjs|node_modules|\.env/)
    await run()
    assert.equal(readFileSync(join(dir, 'builds'), 'utf8'), 'build\n')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a full Linux host returns the busy marker without running the command', { skip: process.platform !== 'linux' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-host-full-'))
  try {
    mkdirSync(join(dir, '.config/juno-runner'), { recursive: true })
    mkdirSync(join(dir, '.cache/juno-runner/jobs'), { recursive: true })
    writeFileSync(join(dir, '.config/juno-runner/cores'), '2')
    writeFileSync(join(dir, '.cache/juno-runner/jobs/other'), `${process.pid} 2 other\n`)
    writeFileSync(join(dir, 'docker'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(dir, 'docker'), 0o755)
    const host = new URL('./runner-host.sh', import.meta.url)
    const result = spawnSync('bash', [host.pathname, '2', 'full-test', 'echo SHOULD_NOT_RUN', '0'], {
      env: { ...process.env, HOME: dir, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 5000,
    })
    assert.equal(result.status, 75, result.stderr)
    assert.match(result.stdout, /__juno_remote_busy/)
    assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN|__juno_remote_allocated/)
    assert.deepEqual(readdirSync(join(dir, '.cache/juno-runner/jobs')), ['other'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('prune removes old local tags and build cache while keeping the selected tag', { skip: process.platform !== 'linux' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-host-prune-'))
  try {
    mkdirSync(join(dir, '.config/juno-runner'), { recursive: true })
    writeFileSync(join(dir, '.config/juno-runner/cores'), '1')
    writeFileSync(join(dir, 'ssh'), '#!/bin/sh\nfor command; do :; done\nexec bash -c "$command"\n')
    writeFileSync(join(dir, 'docker'), `#!/bin/sh
if [ "$1 $2" = 'image ls' ]; then printf 'juno-remote:current\njuno-remote:old\n'
elif [ "$1 $2" = 'image rm' ]; then printf '%s\n' "$3" >> "$HOME/removed"
elif [ "$1 $2" = 'builder prune' ]; then touch "$HOME/cache-pruned"
elif [ "$1" != info ]; then exit 2
fi
`)
    for (const name of ['ssh', 'docker']) chmodSync(join(dir, name), 0o755)
    const result = spawnSync(process.execPath, ['scripts/remote/runner.mjs', '--prune'], {
      env: { ...process.env, HOME: dir, PATH: `${dir}:${process.env.PATH}`, JUNO_RUNNER_HOST: 'host', JUNO_RUNNER_IMAGE: 'juno-remote:current' }, encoding: 'utf8', timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(dir, 'removed'), 'utf8'), 'juno-remote:old\n')
    assert(existsSync(join(dir, 'cache-pruned')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
