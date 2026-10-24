import { toolFixture } from './tool-test-fixture.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { healthBaseline, healthRegressions } from './health-ratchet.mjs'
import { collectSizeReport } from './health-size.mjs'
import { runTool, ToolTimeout } from './health-run.mjs'

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

test('the health ratchet permits improvements but rejects growth and replacement debt', () => {
  const baseline = healthBaseline(report())
  assert.deepEqual(healthRegressions(report(), baseline), [])
  const regressions = [
    ...Object.keys(report().counts).map((key) => (after) => after.counts[key]++),
    (after) => after.size.oversizedFiles[0].file = 'new.ts',
    (after) => after.size.oversizedFunctions[0].id = 'new#1',
    (after) => after.duplication.clonedLines++,
  ]
  for (const change of regressions) {
    const after = report()
    change(after)
    assert.ok(healthRegressions(after, baseline).length > 0)
  }
  const improved = report()
  improved.duplication.clonedLines = 0
  improved.counts.clonePairs = 0
  assert.deepEqual(healthRegressions(improved, baseline), [])
})

test('failed tools and invalid baselines cannot pass or become a baseline', () => {
  const incomplete = { ...report(), complete: false }
  assert.throws(() => healthBaseline(incomplete), /incomplete/)
  assert.equal(healthRegressions(incomplete, healthBaseline(report())).length, 1)
  assert.throws(() => healthRegressions(report(), {}), /Invalid/)
  const baseline = healthBaseline(report())
  baseline.counts.unusedFiles = null
  assert.throws(() => healthRegressions(report(), baseline), /Invalid health count/)

  const late = { ...report(), complete: false, errors: [{ tool: 'knip', message: 'knip timed out', timedOut: true }] }
  const [failure] = healthRegressions(late, healthBaseline(report()))
  assert.match(failure, /timed out \(knip\); no finding was checked/)
  late.errors.push({ tool: 'jscpd', message: 'jscpd: bad config' })
  assert.match(healthRegressions(late, healthBaseline(report()))[0], /failed; fix the report errors/)
})

test('a tool that runs out of time is tried once more, then reported as a timeout', async (t) => {
  const { root: directory, env } = toolFixture(t)
  try {
    const tries = join(directory, 'tries')
    writeFileSync(tries, '')
    const slow = `require('node:fs').appendFileSync(${JSON.stringify(tries)}, 'x'); setTimeout(() => {}, 60_000)`
    await assert.rejects(runTool('slow', process.execPath, ['-e', slow], { env }, 300), (error) => error instanceof ToolTimeout && /slow timed out after .* This is not a finding/.test(error.message))
    assert.equal(readFileSync(tries, 'utf8'), 'xx')
    await assert.rejects(runTool('broken', process.execPath, ['-e', 'process.exit(3)'], { env }, 5000), (error) => !(error instanceof ToolTimeout) && error.message.startsWith('broken: '))
    assert.equal(await runTool('quick', process.execPath, ['-e', 'console.log("ok")'], { env }, 5000), 'ok\n')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('size identities survive line moves and body edits, and distinguish callbacks', (t) => {
  const { root: directory, git } = toolFixture(t)
  git('init', '-q')
  mkdirSync(join(directory, 'scripts'))
  const file = join(directory, 'scripts/sample.ts')
  const body = Array.from({ length: 82 }, (_, i) => `  work(${i})`).join('\n')
  const source = `test('first', () => {\n${body}\n})\ntest('second', () => {\n${body}\n})\n`
  const read = () => collectSizeReport(directory).oversizedFunctions
    .filter((item) => item.file === 'scripts/sample.ts').map(({ id }) => id)
  try {
    writeFileSync(file, source)
    const before = read()
    assert.equal(before.length, 2)
    assert.notEqual(before[0], before[1])
    writeFileSync(file, '\n\n' + source.replace('work(0)', 'changed(0)'))
    assert.deepEqual(read(), before)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
