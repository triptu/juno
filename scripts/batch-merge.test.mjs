import { toolFixture } from './tool-test-fixture.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { mainCheckout, worktreeFolder } from './worktree-folder.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fixture(t) {
  const { root: dir, env: fixtureEnv } = toolFixture(t)
  const command = (bin, args, cwd = dir, env = {}) => spawnSync(bin, args, {
    cwd, encoding: 'utf8', env: { ...fixtureEnv, PATH: `${dir}/bin:${process.env.PATH}`, JUNO_WORKTREE_DIR: resolve(dir, '.claude/worktrees'), ...env },
  })
  const git = (args, cwd = dir) => {
    const result = command('git', args, cwd)
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const write = (file, text) => {
    mkdirSync(dirname(resolve(dir, file)), { recursive: true })
    writeFileSync(resolve(dir, file), text)
  }
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Test'])
  git(['config', 'user.email', 'test@example.invalid'])
  git(['config', 'core.hooksPath', '/dev/null'])
  git(['config', 'commit.gpgsign', 'false'])
  write('.gitignore', '.juno-status/\n.claude/worktrees/\nbin/\n')
  write('shared.txt', 'base\n')
  write('health-baseline.json', '{}\n')
  write('docs/decisions/log/2026-10-16-1200-base.md', '- 10-16 12:00 · Test · Base decision.\n')
  mkdirSync(resolve(dir, 'scripts'))
  for (const script of ['batch-merge.mjs', 'decision-log.mjs', 'worktree-folder.mjs']) copyFileSync(resolve(root, 'scripts', script), resolve(dir, 'scripts', script))
  assert.equal(command(process.execPath, ['scripts/decision-log.mjs']).status, 0)
  write('bin/bun', `#!/bin/sh
if [ "$1" = run ]; then shift; fi
printf '%s\\n' "$*"
if [ "$1" = health:baseline ]; then printf '{"rebuilt":true}\\n' > health-baseline.json; fi
if [ "$1" = affected ] && [ "$FAIL_CHECK" = 1 ]; then exit 7; fi
`)
  command('chmod', ['+x', 'bin/bun'])
  git(['add', '.'])
  git(['commit', '-m', 'Initial fixture'])
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  const branch = (name, files, message = `Add ${name}`) => {
    git(['checkout', '-b', name, 'main'])
    for (const [file, text] of Object.entries(files)) write(file, text)
    git(['add', '.'])
    git(['commit', '-m', message])
    git(['checkout', 'main'])
  }
  const batch = (args, env) => command(process.execPath, ['scripts/batch-merge.mjs', ...args], dir, env)
  const tree = resolve(dir, '.claude/worktrees/batch-1')
  return { dir, tree, git, write, branch, batch, command }
}

test('conflict stops at its branch; continue keeps both fragments and rebuilds generated conflicts', (t) => {
  const f = fixture(t)
  f.branch('one', { 'shared.txt': 'one\n', 'health-baseline.json': '{"one":1}\n',
    'docs/decisions/log/2026-10-17-0055-one.md': '- 10-17 00:55 · Test · One decision.\n' })
  f.branch('two', { 'shared.txt': 'two\n', 'health-baseline.json': '{"two":2}\n',
    'docs/decisions/log/2026-10-17-0056-two.md': '- 10-17 00:56 · Test · Two decision.\n' })
  const stopped = f.batch(['--dry-run', 'one', 'two'])
  assert.equal(stopped.status, 1)
  assert.match(stopped.stderr, /Conflict merging two:[\s\S]*shared.txt/)
  writeFileSync(resolve(f.tree, 'shared.txt'), 'both\n')
  f.git(['add', 'shared.txt'], f.tree)
  const resumed = f.batch(['--continue', 'batch-1'])
  assert.equal(resumed.status, 0, resumed.stderr)
  const log = readFileSync(resolve(f.tree, 'docs/decision-log.md'), 'utf8')
  assert.match(log, /Two decision\.\n.*One decision\.\n.*Base decision\./)
  assert.deepEqual(JSON.parse(readFileSync(resolve(f.tree, 'health-baseline.json'), 'utf8')), { rebuilt: true })
  assert.equal(f.git(['status', '--porcelain'], f.tree), '')
  assert.doesNotMatch(readFileSync(resolve(f.dir, '.juno-status/batches/batch-1.log'), 'utf8'), /^(typecheck|lint|affected --batch.*)$/m)
  assert.equal(f.batch(['--continue', 'batch-1', '--push']).status, 1)
})

test('failed checks retain the batch and --continue retries without merging twice', (t) => {
  const f = fixture(t)
  f.branch('one', { 'one.txt': 'one\n' })
  const failed = f.batch(['--push', 'one'], { FAIL_CHECK: '1' })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /bun failed/)
  assert.ok(existsSync(f.tree))
  const before = f.git(['rev-parse', 'HEAD'], f.tree)
  const resumed = f.batch(['--continue', 'batch-1'])
  assert.equal(resumed.status, 0, resumed.stderr)
  assert.equal(f.git(['rev-parse', 'HEAD'], f.tree), before)
  const log = readFileSync(resolve(f.dir, '.juno-status/batches/batch-1.log'), 'utf8')
  assert.doesNotMatch(log, /\$ git push/)
  // The unit tests the batch reaches, against the batch's base.
  assert.match(log, /^affected --batch --base [0-9a-f]{40}$/m)
})

test('attribution in a commit body blocks publication', (t) => {
  const f = fixture(t)
  f.branch('one', { 'one.txt': 'one\n' }, 'Add file\n\nGenerated with Claude')
  const result = f.batch(['--push', 'one'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /attribution line/)
  assert.ok(existsSync(f.tree))
  assert.doesNotMatch(readFileSync(resolve(f.dir, '.juno-status/batches/batch-1.log'), 'utf8'), /\$ git push/)
})

test('decision check rejects stale output and a mismatched fragment without overwriting the log', (t) => {
  const f = fixture(t)
  f.write('docs/decisions/log/2026-10-17-0055-new.md', '- 10-17 ~00:55 · Test · New decision.\n')
  const before = readFileSync(resolve(f.dir, 'docs/decision-log.md'), 'utf8')
  assert.equal(f.command(process.execPath, ['scripts/decision-log.mjs', '--check']).status, 1)
  assert.equal(readFileSync(resolve(f.dir, 'docs/decision-log.md'), 'utf8'), before)
  assert.equal(f.command(process.execPath, ['scripts/decision-log.mjs']).status, 0)
  assert.equal(f.command(process.execPath, ['scripts/decision-log.mjs', '--check']).status, 0)
  f.write('docs/decisions/log/2026-10-17-0055-bad.md', '- 10-16 00:55 · Test · Wrong date.\n')
  assert.equal(f.command(process.execPath, ['scripts/decision-log.mjs']).status, 1)
})

test('a linked worktree with another folder name finds the main checkout and its name', (t) => {
  const f = fixture(t)
  const linked = resolve(f.dir, '.claude/worktrees/t3-1234')
  f.git(['worktree', 'add', '-b', 'linked', linked, 'main'])
  const main = realpathSync(f.dir)
  assert.equal(realpathSync(mainCheckout(linked)), main)
  const mounted = (path) => path === '/Volumes/AgentWork/.fseventsd/no_log'
  assert.equal(worktreeFolder(mainCheckout(linked), { env: {}, exists: mounted }), worktreeFolder(mainCheckout(f.dir), { env: {}, exists: mounted }))
})
