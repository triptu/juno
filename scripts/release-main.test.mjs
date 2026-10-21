import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { git, releaseGate } from './release-gate.mjs'
import { syncReleasedVersion } from './release-main.mjs'
import { scratchFolder } from './worktree-folder.mjs'

const file = 'apps/desktop/package.json'
function fixture(t) {
  mkdirSync(scratchFolder(), { recursive: true })
  const folder = mkdtempSync(join(scratchFolder(), 'release-main-test-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const remote = join(folder, 'remote.git')
  const root = join(folder, 'repo')
  mkdirSync(root)
  git(folder, 'init', '--bare', '-q', remote)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  mkdirSync(join(root, 'apps/desktop'), { recursive: true })
  writeFileSync(join(root, file), '{"version":"0.1.7","main":"app.js"}\n')
  const commit = (subject) => { git(root, 'add', '.'); git(root, 'commit', '-qm', subject); return git(root, 'rev-parse', 'HEAD') }
  const source = commit('Source')
  git(root, 'remote', 'add', 'origin', remote)
  git(root, 'push', '-q', 'origin', 'main')
  return { root, remote, folder, source, commit }
}
const version = (root) => JSON.parse(git(root, 'show', `origin/main:${file}`)).version

test('an older release updates the current tip with only the version and keeps gate coverage', (t) => {
  const { root, source, commit } = fixture(t)
  writeFileSync(join(root, 'app.js'), 'newer production change')
  const tip = commit('Newer work')
  git(root, 'push', '-q', 'origin', 'main')
  git(root, 'checkout', '--detach', source)
  assert.equal(syncReleasedVersion(root, '0.1.8'), true)
  const bump = git(root, 'rev-parse', 'origin/main')
  assert.equal(git(root, 'rev-parse', `${bump}^`), tip)
  assert.equal(git(root, 'show', `${bump}:app.js`), 'newer production change')
  assert.equal(git(root, 'show', '-s', '--format=%s', bump), 'Set version to 0.1.8 after release')
  assert.equal(git(root, 'diff', '--name-only', tip, bump), file)
  assert.deepEqual(JSON.parse(git(root, 'show', `${bump}:${file}`)), { version: '0.1.8', main: 'app.js' })
  const record = { commit: tip, passed: true, suites: ['test', 'specs:check', 'test:gallery', 'test:desktop'].map((suite) => ({ suite, code: 0 })) }
  assert.equal(releaseGate(root, bump, [record], []).record.commit, tip)
  assert.equal(syncReleasedVersion(root, '0.1.8'), false)
  assert.equal(syncReleasedVersion(root, '0.1.7'), false)
  assert.equal(git(root, 'rev-parse', 'origin/main'), bump)
})

test('a release bump already on the tip is not duplicated', (t) => {
  const { root, commit } = fixture(t)
  writeFileSync(join(root, file), '{"version":"0.1.8","main":"app.js"}\n')
  const bump = commit('Release 0.1.8')
  git(root, 'push', '-q', 'origin', 'main')
  assert.equal(syncReleasedVersion(root, 'v0.1.8'), false)
  assert.equal(git(root, 'rev-parse', 'origin/main'), bump)
})

test('a concurrent main push is rebased without losing its changes', (t) => {
  const { root, remote, folder } = fixture(t)
  const racer = join(folder, 'racer')
  git(folder, 'clone', '-q', '-b', 'main', remote, racer)
  git(racer, 'config', 'user.name', 'Test')
  git(racer, 'config', 'user.email', 'test@example.com')
  writeFileSync(join(racer, 'race.js'), 'concurrent work')
  git(racer, 'add', '.')
  git(racer, 'commit', '-qm', 'Concurrent work')
  const raced = git(racer, 'rev-parse', 'HEAD')
  const hook = join(root, '.git/hooks/pre-push')
  writeFileSync(hook, `#!/bin/sh\nrm "$0"\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\ngit -C '${racer}' push -q origin main\n`)
  chmodSync(hook, 0o755)
  assert.equal(syncReleasedVersion(root, '0.1.8'), true)
  assert.equal(git(root, 'rev-parse', 'origin/main^'), raced)
  assert.equal(git(root, 'show', 'origin/main:race.js'), 'concurrent work')
  assert.equal(version(root), '0.1.8')
})

test('a failed main push can be retried after publication without publishing again', (t) => {
  const { root, remote, folder, source } = fixture(t)
  const hook = join(remote, 'hooks/pre-receive')
  writeFileSync(hook, '#!/bin/sh\nexit 1\n')
  chmodSync(hook, 0o755)
  assert.throws(() => syncReleasedVersion(root, '0.1.8'), /is published.*updating origin\/main failed.*without publishing again/)
  assert.equal(version(root), '0.1.7')
  rmSync(hook)
  // The scheduled CLI must repair before candidate selection.
  const bin = join(folder, 'bin')
  mkdirSync(bin)
  const calls = join(folder, 'gh-calls')
  const gh = join(bin, 'gh')
  writeFileSync(gh, `#!/usr/bin/env node\nconst fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n');\nif (process.argv[2] === 'auth') process.exit(0); if (process.argv[2] !== 'release' || !['list', 'view'].includes(process.argv[3])) process.exit(99);\nconsole.log(JSON.stringify(process.argv[3] === 'list' ? [{tagName:'v0.1.8',isDraft:false,isPrerelease:false,publishedAt:new Date().toISOString()}] : {body:'<!-- juno-source: ${source} -->'}));\n`)
  chmodSync(gh, 0o755)
  // Copy the real entry point, changing only its repository root for this fixture.
  const script = resolve(import.meta.dirname, 'release-scheduled.mjs')
  const runner = join(root, 'scheduled.mjs')
  const code = readFileSync(script, 'utf8').replaceAll(/from '\.\//g, `from '${import.meta.dirname}/`).replace(/from '\.\.\/apps\//, `from '${resolve(import.meta.dirname, '../apps')}/`).replace("resolve(import.meta.dirname, '..')", JSON.stringify(root))
  writeFileSync(runner, code)
  const run = () => execFileSync(process.execPath, [runner], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' })
  assert.match(run(), /no publish needed/)
  const bump = git(root, 'rev-parse', 'origin/main')
  assert.match(run(), /no action/)
  assert.equal(git(root, 'rev-parse', 'origin/main'), bump)
  assert.equal(version(root), '0.1.8')
  git(root, 'checkout', '--detach', 'origin/main')
  const publish = resolve(import.meta.dirname, 'release-publish.ts')
  const output = execFileSync(process.execPath, [publish, '--checkout', root], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' })
  assert.match(output, /already published/)
  assert.equal(git(root, 'rev-parse', 'origin/main'), bump)
  assert.doesNotMatch(readFileSync(calls, 'utf8'), /create|edit|api/)
})
