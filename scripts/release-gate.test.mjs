import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assessRecord, compatible, git, readRecords, releaseGate } from './release-gate.mjs'
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
  assert.equal(releaseGate(root, next, [bad, green(first)]).record.commit, first)
  assert.equal(compatible(root, next, first), false)
  writeFileSync(join(root, 'apps/desktop/package.json'), '{"version":"0.1.1","main":"other.js"}')
  assert.equal(releaseGate(root, commit(), [green(first)]), null)
  writeFileSync(join(root, 'app.ts'), 'production')
  assert.equal(compatible(root, first, commit()), false)
})

test('failed or incomplete full runs cannot pass', () => {
  const record = green('a'.repeat(40))
  assert.equal(assessRecord(record), true)
  assert.equal(assessRecord({ ...record, passed: false }), false)
  assert.equal(assessRecord({ ...record, suites: record.suites.slice(0, -1) }), false)
  for (const code of [1, 2, null]) {
    const suites = [...record.suites.slice(0, -1), {
      suite: 'test:desktop', code,
      tests: { status: 'failed', errors: 0, incomplete: 0, failures: [{ id: 'known', title: 'Known test' }] },
    }]
    assert.equal(assessRecord({ ...record, suites }), false)
    assert.equal(assessRecord({ ...record, passed: false, suites }), false)
  }
})

test('reads archived results as well as the latest result', (t) => {
  const root = mkdtempSync(join(scratchFolder(), 'release-records-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const archived = join(root, 'verify-main/commits', 'a'.repeat(40))
  mkdirSync(archived, { recursive: true })
  writeFileSync(join(archived, 'run.json'), JSON.stringify(green('a'.repeat(40))))
  writeFileSync(join(root, 'verify-main.json'), JSON.stringify(green('b'.repeat(40))))
  assert.equal(readRecords(root).length, 2)
  writeRecord(root, 'next-run', green('c'.repeat(40)))
  assert.equal(readRecords(root).length, 3)

})

test('a repair can pass only with its recorded ancestor and complete successful outcomes', (t) => {
  const root = mkdtempSync(join(scratchFolder(), 'release-repair-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  writeFileSync(join(root, 'app.ts'), 'before')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Before')
  const before = git(root, 'rev-parse', 'HEAD')
  writeFileSync(join(root, 'app.ts'), 'fixed')
  git(root, 'commit', '-qam', 'Fix')
  const commit = git(root, 'rev-parse', 'HEAD')
  const identity = { bun: '1.4.4', platform: 'linux', arch: 'x64', electron: '44' }
  const required = ['test', 'specs:check', 'specs:conformance', 'test:gallery', 'test:desktop']
  const baseline = { version: 2, commit: before, finishedAt: 'before', passed: false, identity, required, suites: required.map((suite) => ({ suite, code: 1 })) }
  const repaired = { ...baseline, commit, finishedAt: 'after', passed: true, suites: required.map((suite) => ({ suite, code: 0 })), repair: { commit: before, finishedAt: 'before', selection: 'graph-uncapped' } }
  assert.ok(releaseGate(root, commit, [repaired, baseline]))
  assert.equal(releaseGate(root, commit, [repaired]), null)
  assert.equal(releaseGate(root, commit, [{ ...repaired, identity: { ...identity, bun: 'other' } }, baseline]), null)
  const incomplete = { ...repaired, suites: repaired.suites.map((suite) => suite.suite === 'test:desktop' ? { ...suite, tests: { status: 'passed', errors: 0, incomplete: 1, failures: [] } } : suite) }
  assert.equal(releaseGate(root, commit, [incomplete, baseline]), null)
})

test('release timings from a disposable checkout remain in the shared main status directory', async (t) => {
  const { cpSync, readFileSync } = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  const root = mkdtempSync(join(scratchFolder(), 'release-timings-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const main = join(root, 'main')
  mkdirSync(join(main, 'scripts'), { recursive: true })
  writeFileSync(join(main, 'package.json'), '{"type":"module"}')
  for (const name of ['release-timings.mjs', 'release-gate.mjs', 'verify-inputs.mjs', 'verify-repair.mjs']) cpSync(join(import.meta.dirname, name), join(main, 'scripts', name))
  git(main, 'init', '-q')
  git(main, 'config', 'user.name', 'Test')
  git(main, 'config', 'user.email', 'test@example.com')
  git(main, 'add', '.')
  git(main, 'commit', '-qm', 'Fixture')
  const checkout = join(root, 'release')
  git(main, 'worktree', 'add', '--detach', checkout, 'HEAD')
  execFileSync(process.execPath, ['--input-type=module', '-e', "import { recordReleaseTiming } from './scripts/release-timings.mjs'; recordReleaseTiming('package', Date.now(), {status:'passed'})"], { cwd: checkout })
  git(main, 'worktree', 'remove', checkout)
  assert.equal(JSON.parse(readFileSync(join(main, '.juno-status/release-timings.json'), 'utf8')).steps[0].step, 'package')
})
