import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releaseDue, releaseNotes, selectCommit } from './release-schedule.mjs'
import { execFileSync } from 'node:child_process'
import { git, statusFolder } from './release-gate.mjs'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { scratchFolder } from './worktree-folder.mjs'

test('missing eligible commits and already released commits do nothing', () => {
  assert.match(releaseDue({ candidate: null }), /no commit/)
  assert.match(releaseDue({ candidate: 'a', previous: 'a' }), /already released/)
  assert.equal(releaseDue({ candidate: 'b', previous: 'a' }), null)
})

test('a normal release can follow immediately after the previous release', (t) => {
  mkdirSync(scratchFolder(), { recursive: true })
  const root = mkdtempSync(join(scratchFolder(), 'release-immediate-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  mkdirSync(join(root, 'apps/desktop/src'), { recursive: true })
  writeFileSync(join(root, 'apps/desktop/package.json'), '{"version":"0.1.8"}\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Previous release')
  const previous = git(root, 'rev-parse', 'HEAD')
  writeFileSync(join(root, 'apps/desktop/src/app.js'), 'new message fix')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Fix message edits after reconnect')
  const candidate = git(root, 'rev-parse', 'HEAD')
  git(root, 'update-ref', 'refs/remotes/origin/main', candidate)
  const records = join(statusFolder(root), 'verify-main/commits')
  mkdirSync(records, { recursive: true })
  writeFileSync(join(records, 'green.json'), JSON.stringify({ commit: candidate, passed: true, finishedAt: new Date().toISOString(), suites: ['test', 'specs:check', 'test:gallery', 'test:desktop'].map((suite) => ({ suite, code: 0 })) }))
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const gh = join(bin, 'gh')
  writeFileSync(gh, `#!/usr/bin/env node
if (process.argv[2] !== 'release' || !['list', 'view'].includes(process.argv[3])) process.exit(99)
console.log(JSON.stringify(process.argv[3] === 'list' ? [{tagName:'v0.1.8',isDraft:false,isPrerelease:false,publishedAt:new Date().toISOString()}] : {body:'<!-- juno-source: ${previous} -->'}))
`)
  chmodSync(gh, 0o755)
  // Run the real dry-run entry point against this repository and GitHub fixture.
  const script = resolve(import.meta.dirname, 'release-scheduled.mjs')
  const runner = join(root, 'scheduled.mjs')
  const code = readFileSync(script, 'utf8').replaceAll(/from '\.\//g, `from '${import.meta.dirname}/`).replace(/from '\.\.\/apps\//, `from '${resolve(import.meta.dirname, '../apps')}/`).replace("resolve(import.meta.dirname, '..')", JSON.stringify(root))
  writeFileSync(runner, code)
  const output = execFileSync(process.execPath, [runner, '--dry-run'], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' })
  assert.match(output, new RegExp(`would release 0\\.1\\.9 from ${candidate}`))
  assert.match(output, /Messages: Fix message edits after reconnect/)
  const notes = join(root, 'notes.md')
  writeFileSync(notes, '- Keep your place after scrolling.\n')
  const reviewed = execFileSync(process.execPath, [runner, '--dry-run', '--notes', notes], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' })
  assert.match(reviewed, /Keep your place after scrolling/)
  assert.doesNotMatch(reviewed, /Messages: Fix message edits after reconnect/)
})

test('notes group user changes and omit merge and test maintenance subjects', () => {
  assert.equal(releaseNotes(['', '  ']).trim(), '')
  const notes = releaseNotes(['Merge ci-fix', 'Release 0.1.7', 'Set version to 0.1.8 after release', 'Refresh the coverage map', 'Fix message edits after reconnect', 'Keep sidebar rows steady', 'Fix message edits after reconnect'])
  assert.equal(notes, '- Messages: Fix message edits after reconnect.\n- Navigation: Keep sidebar rows steady.\n')
})

test('selects the newest compatible main commit, leaving untested production changes behind', (t) => {
  mkdirSync(scratchFolder(), { recursive: true })
  const root = mkdtempSync(join(scratchFolder(), 'release-selection-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.com')
  const commit = (file) => { writeFileSync(join(root, file), file); git(root, 'add', '.'); git(root, 'commit', '-qm', file); return git(root, 'rev-parse', 'HEAD') }
  const first = commit('app.js')
  const docs = commit('README.md')
  const tip = commit('other.js')
  const record = { commit: first, passed: true, suites: ['test', 'specs:check', 'test:gallery', 'test:desktop'].map((suite) => ({ suite, code: 0 })) }
  assert.equal(selectCommit(root, tip, [record]), docs)
  assert.equal(selectCommit(root, tip, []), null)
})

test('finds a verified source merged through the second parent without releasing untested code', (t) => {
  mkdirSync(scratchFolder(), { recursive: true })
  const root = mkdtempSync(join(scratchFolder(), 'release-merged-source-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  const commit = (file) => { writeFileSync(join(root, file), file); git(root, 'add', '.'); git(root, 'commit', '-qm', file); return git(root, 'rev-parse', 'HEAD') }
  const previous = commit('app.js')
  git(root, 'branch', 'feature')
  const verified = commit('gallery.js')
  const docs = commit('README.md')
  git(root, 'checkout', '-q', 'feature')
  commit('search.js')
  git(root, 'merge', '--no-ff', '-qm', 'Merge main', 'main')
  const tip = git(root, 'rev-parse', 'HEAD')
  const record = (commit) => ({ commit, passed: true, suites: ['test', 'specs:check', 'test:gallery', 'test:desktop'].map((suite) => ({ suite, code: 0 })) })
  assert.equal(selectCommit(root, tip, [record(verified), record(previous)]), docs)
})
