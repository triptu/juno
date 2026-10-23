import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { verifyExecution } from './verify-execution.mjs'
import { assessRecord, git, readRecords, releaseGate } from './release-gate.mjs'
import { scratchFolder } from './worktree-folder.mjs'

test('explicit local skips probing; unreachable falls back once; reachable stays remote; configuration errors fail', () => {
  let calls = 0
  const messages = []
  const deps = { config: () => ({ host: 'runner' }), probe: () => { calls++; return { reachable: false, reason: 'offline' } }, log: (line) => messages.push(line) }
  assert.deepEqual(verifyExecution(true, deps), { mode: 'local', host: hostname() })
  assert.equal(calls, 0)
  assert.equal(verifyExecution(false, deps).mode, 'local')
  assert.equal(calls, 1)
  assert.match(messages[0], /runner.*unreachable: offline.*heavy lock.*no retry/)
  assert.deepEqual(verifyExecution(false, { ...deps, probe: () => ({ reachable: true }) }), { mode: 'remote', host: 'runner' })
  assert.throws(() => verifyExecution(false, { ...deps, probe: () => { throw new Error('SSH configuration failed') } }), /SSH configuration failed/)
})

test('local and fallback runs archive eligible records, refresh coverage, and preserve failed suites', { timeout: 120_000 }, (t) => {
  mkdirSync(scratchFolder(), { recursive: true })
  const root = mkdtempSync(join(scratchFolder(), 'verify-main-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(resolve(import.meta.dirname), join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'apps/desktop/e2e'), { recursive: true })
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'bin/package.json'), '{"type":"commonjs"}')
  mkdirSync(join(root, 'tstack/scripts/runner'), { recursive: true })
  writeFileSync(join(root, 'tstack/scripts/runner/host.sh'), '# fixture\n')
  writeFileSync(join(root, 'package.json'), '{"type":"module","packageManager":"bun@1.4.4","devDependencies":{"@informalsystems/quint":"0.33.0"}}')
  writeFileSync(join(root, 'bin/bun'), `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
const [suite, ...args] = argv[0] === 'run' ? argv.slice(1) : argv;
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({suite,args,held:process.env.JUNO_HEAVY_HELD,skip:process.env.JUNO_SKIP_TAGS,coverage:process.env.JUNO_COVERAGE,workers:process.env.JUNO_E2E_WORKERS})+'\\n');
if (suite === 'install') { fs.writeFileSync('installed', 'yes'); process.exit(0); }
if (!fs.existsSync('installed')) process.exit(9);
if (suite === 'test:desktop' && process.env.JUNO_COVERAGE === '1') {
  fs.mkdirSync('apps/desktop/coverage/map', {recursive:true});
  fs.writeFileSync('apps/desktop/coverage/map/partial-local.json', JSON.stringify({specs:{'apps/desktop/e2e/app.spec.ts':['apps/desktop/src/main.ts']},bundled:['apps/desktop/src/main.ts']}));
}
console.log('fixture '+suite);
process.exit(suite === process.env.TEST_FAIL_SUITE ? 7 : 0);
`)
  writeFileSync(join(root, 'bin/ssh'), `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.TEST_PROBES, 'probe\\n');
console.error('Connection refused'); process.exit(255);
`)
  for (const name of ['bun', 'ssh']) chmodSync(join(root, 'bin', name), 0o755)
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Fixture')
  const commit = git(root, 'rev-parse', 'HEAD')
  const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, TSTACK_HOME: join(root, 'tstack'), JUNO_RUNNER_HOST: 'runner.test', TEST_CALLS: join(root, 'calls'), TEST_PROBES: join(root, 'probes') }
  const invoke = (args, extra = {}) => spawnSync(process.execPath, ['scripts/verify-main.mjs', '--ref', 'HEAD', ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60_000 })
  const dry = invoke(['--local', '--dry-run', '--nightly'])
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /SPECS_CACHE=off.*specs:check --no-cache/)
  assert.match(dry.stdout, /test:desktop --grep @mac, then perf, then test:feel/)
  assert.equal(existsSync(join(root, '.juno-status')), false)
  assert.equal(existsSync(env.TEST_CALLS), false)
  for (const [args, failing] of [[['--local'], false], [[], false], [['--local', '--with-mac'], true]]) {
    writeFileSync(env.TEST_CALLS, '')
    const result = invoke(args, { TEST_FAIL_SUITE: failing ? 'specs:conformance' : '' })
    assert.equal(result.status, failing ? 1 : 0, result.stderr + result.stdout)
    const summary = JSON.parse(readFileSync(join(root, '.juno-status/verify-main.json'), 'utf8'))
    assert.deepEqual(summary.execution, { mode: 'local', host: hostname() })
    assert.equal(assessRecord(summary), !failing)
    assert.equal(summary.passed, !failing)
    assert.deepEqual(summary.suites.slice(0, 5).map((s) => s.suite), ['test', 'specs:check', 'specs:conformance', 'test:gallery', 'test:desktop'])
    assert.ok(summary.suites.every((s) => s.host === hostname()))
    const map = JSON.parse(readFileSync(join(root, 'apps/desktop/e2e/coverage-map.json'), 'utf8'))
    assert.equal(map.commit, commit)
    assert.deepEqual(map.files, { 'apps/desktop/src/main.ts': [0] })
    const calls = readFileSync(env.TEST_CALLS, 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(calls.slice(0, 6).map((c) => c.suite), ['install', 'test', 'specs:check', 'specs:conformance', 'test:gallery', 'test:desktop'])
    assert.ok(calls.slice(0, 6).every((c) => c.held === '1'))
    assert.equal(calls[5].coverage, '1')
    assert.equal(calls[5].skip, '@mac')
    assert.equal(calls[5].workers, '1')
    if (failing) {
      assert.equal(summary.suites[2].code, 7)
      assert.deepEqual(calls.slice(6).map((c) => c.suite), ['test:desktop', 'perf', 'test:feel'])
      assert.deepEqual(calls[6].args, ['--grep', '@mac'])
      assert.equal(calls[6].skip, undefined)
    }
  }
  assert.equal(readFileSync(env.TEST_PROBES, 'utf8'), 'probe\n')
  assert.equal(readRecords(join(root, '.juno-status')).filter((r) => r.execution).length, 3)
  assert.equal(releaseGate(root, commit).record.passed, true)
})
