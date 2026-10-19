import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releaseDue, releaseNotes, selectCommit } from './release-schedule.mjs'
import { git } from './release-gate.mjs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scratchFolder } from './worktree-folder.mjs'

test('six-hour cadence and already released commits do nothing', () => {
  const now = Date.parse('2026-10-18T18:00:00Z')
  assert.match(releaseDue({ candidate: null }), /no commit/)
  assert.match(releaseDue({ candidate: 'a', previous: 'a' }), /already released/)
  assert.match(releaseDue({ candidate: 'b', previous: 'a', now, publishedAt: '2026-10-18T12:00:01Z' }), /6 hours/)
  assert.equal(releaseDue({ candidate: 'b', previous: 'a', now, publishedAt: '2026-10-18T12:00:00Z' }), null)
})

test('notes group user changes and omit merge and test maintenance subjects', () => {
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
