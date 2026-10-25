import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FULL_EVERY_MS, perfRuns, selectPerf } from './perf-select.mjs'

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-10-26T00:00:00Z')
const titles = ['perf.spec.ts › palette: ⌘K to recent rows', 'perf.spec.ts › peek: the peek key over a hovered row', 'perf.spec.ts › large workspace › launch warm start: main process to shell and rows', 'perf.spec.ts › quick start: first sign-in to sidebar rows']

/** A verify-main record with a laptop perf suite whose cases have these outcomes. */
const record = (commit, daysAgo, outcomes, full = false) => ({
  commit, finishedAt: new Date(now - daysAgo * DAY).toISOString(),
  suites: [{ suite: 'perf', host: 'runner', perf: { full }, tests: { cases: [{ title: 'build', project: 'build-electron', outcome: 'expected' }, ...titles.map((title, i) => ({ title, project: 'electron', outcome: outcomes[i] }))] } }],
})

test('a nightly runs what changed since each scenario last passed, everything a week after the last full run', () => {
  const runs = perfRuns([
    // Yesterday peek failed; palette and the rest passed.
    record('b', 1, ['expected', 'unexpected', 'expected', 'expected']),
    record('a', 3, ['expected', 'expected', 'expected', 'expected'], true),
  ], 'runner')
  const changes = { b: ['apps/desktop/src/renderer/containers/Palette.tsx', 'docs/performance.md'], a: [] }
  const plan = selectPerf({ runs, now, changedSince: (commit) => changes[commit] })
  // Palette changed; peek has not passed since it failed; launch and the rest saw no shared change.
  assert.equal(plan.full, false)
  assert.ok(plan.run.includes('⌘K open and typing') && plan.run.includes('peek'))
  assert.ok(!plan.run.includes('launch') && !plan.run.includes('other scenarios'))
  const grep = new RegExp(plan.grep)
  assert.deepEqual(titles.map((title) => grep.test(title)), [true, true, false, false])

  // Shared code reaches every scenario; docs and other lanes' tests reach none.
  const shared = selectPerf({ runs, now, changedSince: () => ['packages/ui/src/Button.tsx'] })
  assert.equal(shared.grep, undefined)
  const passing = perfRuns([record('c', 1, ['expected', 'expected', 'expected', 'expected']), record('a', 3, ['expected', 'expected', 'expected', 'expected'], true)], 'runner')
  const quiet = new RegExp(selectPerf({ runs: passing, now, changedSince: () => ['docs/performance.md', 'apps/desktop/e2e/sidebar.spec.ts'] }).grep)
  assert.deepEqual(titles.filter((title) => quiet.test(title)), [])
  // The perf harness counts as code it measures.
  assert.equal(selectPerf({ runs: passing, now, changedSince: () => ['apps/desktop/e2e/perfScroll.ts'] }).grep, undefined)
  // A rebased-away commit is not an ancestor: run its scenarios again.
  assert.equal(selectPerf({ runs: passing, now, changedSince: () => undefined }).grep, undefined)

  assert.equal(selectPerf({ runs: passing, now: now - 3 * DAY + FULL_EVERY_MS, changedSince: () => [] }).full, true)
  assert.equal(selectPerf({ runs: perfRuns([record('c', 1, ['expected', 'expected', 'expected', 'expected'])], 'runner'), now, changedSince: () => [] }).full, true)
  // Another host's results (the Mac's) do not count.
  assert.deepEqual(perfRuns([record('c', 1, ['expected', 'expected', 'expected', 'expected'])], 'mac'), [])
})
