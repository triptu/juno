import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assessRecord, compatible, git, readRecords, readWaivers, releaseGate } from './release-gate.mjs'
import { writeRecord } from './verify-records.mjs'
import { scratchFolder } from './worktree-folder.mjs'

export const green = (commit) => ({ commit, finishedAt: '2026-10-18T10:00:00Z', passed: true, suites: ['test', 'specs:check', 'test:gallery', 'test:desktop'].map((suite) => ({ suite, code: 0 })) })

test('a release can use an older green record plus docs, tests and a version bump', (t) => {
  mkdirSync(scratchFolder(), { recursive: true })
  const root = mkdtempSync(join(scratchFolder(), 'release-gate-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  mkdirSync(join(root, 'apps/desktop'), { recursive: true })
  writeFileSync(join(root, 'apps/desktop/package.json'), '{"version":"0.1.0","main":"app.js"}')
  const commit = () => { git(root, 'add', '.'); git(root, 'commit', '-qm', 'Change'); return git(root, 'rev-parse', 'HEAD') }
  const first = commit()
  writeFileSync(join(root, 'README.md'), 'Docs')
  writeFileSync(join(root, 'a.test.ts'), 'test')
  writeFileSync(join(root, 'apps/desktop/package.json'), '{"version":"0.1.1","main":"app.js"}')
  const next = commit()
  const bad = { ...green(next), passed: false, suites: green(next).suites.map((suite) => ({ ...suite, code: 1 })) }
  assert.equal(releaseGate(root, next, [bad, green(first)], []).record.commit, first)
  assert.equal(compatible(root, next, first), false)
  writeFileSync(join(root, 'apps/desktop/package.json'), '{"version":"0.1.1","main":"other.js"}')
  assert.equal(releaseGate(root, commit(), [green(first)], []), null)
  writeFileSync(join(root, 'app.ts'), 'production')
  assert.equal(compatible(root, first, commit()), false)
})

test('only explicitly waived test failures in complete reports can pass', () => {
  const record = green('a'.repeat(40))
  const suite = record.suites.at(-1)
  record.passed = false
  suite.code = 1
  const waiver = { id: 'known', reason: 'Intermittent animation race', date: '2026-10-18' }
  assert.equal(assessRecord(record, [waiver]), null)
  suite.tests = { status: 'failed', errors: 0, incomplete: 0, failures: [{ id: 'known', title: 'Known test' }] }
  assert.equal(assessRecord(record, [waiver]).length, 1)
  assert.equal(assessRecord(record, []), null)
  for (const change of [{ errors: 1 }, { incomplete: 1 }, { status: 'timedout' }, { failures: [] }, { failures: [{ id: 'new' }] }]) {
    assert.equal(assessRecord({ ...record, suites: [...record.suites.slice(0, -1), { ...suite, tests: { ...suite.tests, ...change } }] }, [waiver]), null)
  }
  assert.equal(assessRecord({ suites: [] }, []), null)
})

test('reads archived results as well as the latest result and validates waivers', (t) => {
  const root = mkdtempSync(join(scratchFolder(), 'release-records-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const archived = join(root, 'verify-main/commits', 'a'.repeat(40))
  mkdirSync(archived, { recursive: true })
  writeFileSync(join(archived, 'run.json'), JSON.stringify(green('a'.repeat(40))))
  writeFileSync(join(root, 'verify-main.json'), JSON.stringify(green('b'.repeat(40))))
  assert.equal(readRecords(root).length, 2)
  writeRecord(root, 'next-run', green('c'.repeat(40)))
  assert.equal(readRecords(root).length, 3)
  assert.deepEqual(readWaivers(root), [])
  writeFileSync(join(root, 'release-waivers.json'), '[{"id":"x"}]')
  assert.throws(() => readWaivers(root), /reason/)
})
