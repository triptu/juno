import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { healthBaseline, healthRegressions } from './health-ratchet.mjs'
import { collectSizeReport } from './health-size.mjs'
import { runTool, timeLimit, ToolTimeout } from './health-run.mjs'

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

test('a timed-out tool is reported as a timeout, not as a failure or a finding', () => {
  const late = { ...report(), complete: false, errors: [{ tool: 'knip', message: 'knip timed out', timedOut: true }] }
  const [failure] = healthRegressions(late, healthBaseline(report()))
  assert.match(failure, /timed out \(knip\); no finding was checked/)
  late.errors.push({ tool: 'jscpd', message: 'jscpd: bad config' })
  assert.match(healthRegressions(late, healthBaseline(report()))[0], /failed; fix the report errors/)
})

test('the time limit grows with the load', () => {
  assert.equal(timeLimit(20_000, 2, 8), 20_000)
  assert.equal(timeLimit(20_000, 16, 8), 40_000)
  assert.equal(timeLimit(20_000, 200, 8), 120_000)
})

test('a tool that runs out of time is tried once more, then reported as a timeout', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'juno-health-run-'))
  try {
    const tries = join(directory, 'tries')
    writeFileSync(tries, '')
    const slow = `require('node:fs').appendFileSync(${JSON.stringify(tries)}, 'x'); setTimeout(() => {}, 60_000)`
    await assert.rejects(runTool('slow', process.execPath, ['-e', slow], {}, 300), (error) => error instanceof ToolTimeout && /slow timed out after .* This is not a finding/.test(error.message))
    assert.equal(readFileSync(tries, 'utf8'), 'xx')
    await assert.rejects(runTool('broken', process.execPath, ['-e', 'process.exit(3)'], {}, 5000), (error) => !(error instanceof ToolTimeout) && error.message.startsWith('broken: '))
    assert.equal(await runTool('quick', process.execPath, ['-e', 'console.log("ok")'], {}, 5000), 'ok\n')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('size identities survive line moves and body edits, and distinguish callbacks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'juno-health-'))
  execFileSync('git', ['init', '-q', directory])
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
