import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { healthBaseline, healthRegressions } from './health-ratchet.mjs'
import { collectSizeReport } from './health-size.mjs'

function report() {
  return {
    complete: true,
    timestamp: '2026-10-15T00:00:00.000Z',
    counts: { unusedFiles: 0, unusedExports: 0, unusedTypes: 0, unusedDependencies: 0,
      unlistedDependencies: 0, clonePairs: 2, oversizedFiles: 1, oversizedFunctions: 1 },
    duplication: { clonedLines: 20 },
    size: { fileLimit: 400, functionLimit: 80,
      oversizedFiles: [{ file: 'old.ts', lines: 401 }],
      oversizedFunctions: [{ file: 'old.ts', id: 'old#1', name: 'old', line: 1, lines: 81 }] },
  }
}

test('every count is checked, including unused types and dependencies', () => {
  const before = report()
  const baseline = healthBaseline(before)
  assert.deepEqual(healthRegressions(before, baseline), [])
  for (const key of Object.keys(before.counts)) {
    const after = structuredClone(before)
    after.counts[key]++
    assert.ok(healthRegressions(after, baseline).some((failure) => failure.startsWith(`${key}:`)))
  }
})

test('new large files and functions fail even if another one was removed', () => {
  const before = report()
  const after = report()
  after.size.oversizedFiles[0].file = 'new.ts'
  after.size.oversizedFunctions[0].id = 'new#1'
  assert.equal(healthRegressions(after, healthBaseline(before)).length, 2)
})

test('growing clones fail without adding a pair; improvements pass', () => {
  const before = report()
  const after = report()
  after.duplication.clonedLines++
  assert.match(healthRegressions(after, healthBaseline(before))[0], /clonedLines/)
  after.duplication.clonedLines = 0
  after.counts.clonePairs = 0
  assert.deepEqual(healthRegressions(after, healthBaseline(before)), [])
})

test('failed tools and invalid baselines cannot pass or become a baseline', () => {
  const incomplete = { ...report(), complete: false }
  assert.throws(() => healthBaseline(incomplete), /incomplete/)
  assert.equal(healthRegressions(incomplete, healthBaseline(report())).length, 1)
  assert.throws(() => healthRegressions(report(), {}), /Invalid/)
  const baseline = healthBaseline(report())
  baseline.counts.unusedFiles = null
  assert.throws(() => healthRegressions(report(), baseline), /Invalid health count/)
})

test('size identities survive line moves and body edits, and distinguish callbacks', () => {
  const directory = mkdtempSync('scripts/health-fixture-')
  const file = join(directory, 'sample.ts')
  const body = Array.from({ length: 82 }, (_, i) => `  work(${i})`).join('\n')
  const source = `test('first', () => {\n${body}\n})\ntest('second', () => {\n${body}\n})\n`
  const read = () => collectSizeReport().oversizedFunctions
    .filter((item) => item.file === relative(process.cwd(), file)).map(({ id }) => id)
  try {
    writeFileSync(file, source)
    const before = read()
    assert.equal(before.length, 2)
    assert.notEqual(before[0], before[1])
    writeFileSync(file, '\n\n' + source.replace('work(0)', 'changed(0)'))
    assert.deepEqual(read(), before)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
