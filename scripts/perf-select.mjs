// Which desktop perf scenarios a nightly runs (docs/performance.md 7.3).
// A scenario is skipped while nothing it measures changed since it last
// passed on the laptop; every scenario runs at least once a week.
//
// Each interaction in PERF_INTERACTIONS (test-areas.mjs) owns its paths and
// names its scenarios with a grep. A changed file in no interaction's paths
// that the app or the harness runs (shared code, a dependency, the fake's
// seeds) reaches every scenario. Docs and other lanes' tests reach none.
//
// The package budgets (the engine's and the agent's `*.perf.ts`) are chosen
// per file, by the files each one imports: an engine benchmark does not run
// for a change to the renderer.

import { docsOrTests } from './release-gate.mjs'
import { inPaths, PERF_INTERACTIONS } from './test-areas.mjs'

export const FULL_EVERY_MS = 7 * 24 * 60 * 60 * 1000

/** The harness files the perf scenarios run, which docsOrTests counts as tests. */
const HARNESS = [/^apps\/desktop\/e2e\/(perf[A-Za-z]*\.ts|[^/]*\.perf\.spec\.ts|perf-baseline\.json|fixtures\.ts|launch\.ts|synced\.ts|no-skips\.ts)$/, /^apps\/desktop\/e2e\/(driver|setup)\//, 'apps/desktop/playwright.perf.config.ts', 'apps/desktop/playwright.config.ts']

/** Whether `file` can change what a perf scenario measures. */
export const measured = (file) => inPaths(HARNESS, file) || !(docsOrTests(file) || /^(specs|apps\/gallery|\.claude|\.github)\//.test(file) || /^scripts\/(?!perf|remote\/run\.sh|build-cached|without-run-as-node)/.test(file))

/** The scenarios that match no interaction's grep, as one group. */
export const REST = { interaction: 'other scenarios', paths: [] }

const groups = () => [...PERF_INTERACTIONS, REST]
const grepOf = (group) => group === REST ? `^(?!.*(?:${PERF_INTERACTIONS.map((entry) => entry.perf).join('|')}))` : `(?:${group.perf})`

/**
 * Each group's pass in the newest run that ran it: `{ commit, at }` by
 * interaction. A group that failed there has none, so it runs until it
 * passes. `runs` are the laptop perf results, newest first, each with the
 * case titles that passed and those that failed.
 */
export function lastPasses(runs) {
  const found = new Map()
  const decided = new Set()
  for (const run of runs) {
    for (const group of groups()) {
      if (decided.has(group.interaction)) continue
      const pattern = new RegExp(grepOf(group))
      if (![...run.passed, ...run.failed].some((title) => pattern.test(title))) continue
      decided.add(group.interaction)
      if (run.failed.every((title) => !pattern.test(title))) found.set(group.interaction, { commit: run.commit, at: run.at })
    }
  }
  return found
}

/**
 * The plan for a nightly from earlier laptop `runs` (perfRuns): every
 * scenario when the last full run is a week old, else the groups a change
 * reaches since each last passed. `changedSince(commit)` lists the
 * files changed from `commit` to the commit under test, or undefined when
 * `commit` is not an ancestor.
 */
export function selectPerf({ runs, now, changedSince }) {
  const passes = lastPasses(runs)
  const lastFull = runs.find((run) => run.full)?.at
  if (lastFull === undefined || now - lastFull >= FULL_EVERY_MS) return { full: true, grep: undefined, run: groups().map((group) => group.interaction), skipped: [] }
  const run = []
  const skipped = []
  for (const group of groups()) {
    const pass = passes.get(group.interaction)
    const changed = pass === undefined ? undefined : changedSince(pass.commit)
    const reached = changed === undefined || changed.filter(measured).some((file) => inPaths(group.paths, file) || !PERF_INTERACTIONS.some((entry) => inPaths(entry.paths, file)))
    if (reached) run.push(group.interaction)
    else skipped.push({ interaction: group.interaction, commit: pass.commit })
  }
  const grep = run.length === groups().length ? undefined : run.length === 0 ? null : groups().filter((group) => run.includes(group.interaction)).map(grepOf).join('|')
  return { full: false, grep, run, skipped }
}

/**
 * The laptop perf results in `records` (verify-main records, newest first):
 * each run's commit, finish time and passed and failed scenario titles.
 * Flaky scenarios count as failed: a number that needed a retry is not a pass.
 */
export function perfRuns(records, host) {
  return records.flatMap((record) => {
    const suite = record.suites.find((item) => item.suite === 'perf' && item.host === host && Array.isArray(item.tests?.cases))
    if (suite === undefined) return []
    const cases = suite.tests.cases.filter((test) => test.project !== 'build-electron')
    return [{ commit: record.commit, at: Date.parse(record.finishedAt), full: suite.perf?.full === true, units: suite.perfUnits ?? [],
      passed: cases.filter((test) => test.outcome === 'expected').map((test) => test.title),
      failed: cases.filter((test) => test.outcome !== 'expected' && test.outcome !== 'skipped').map((test) => test.title) }]
  })
}

/** A dependency change reaches every package budget. */
const EVERYTHING = ['bun.lock', 'package.json', 'scripts/perf.mjs']

/**
 * The package budget files a nightly runs: all of them in a full run, else
 * each file whose newest run failed, or that has none, or whose imports
 * (`closure(file)`, a Set of repo paths with the file itself) changed since
 * it passed.
 */
export function selectUnits({ runs, files, closure, changedSince, full }) {
  if (full) return files
  return files.filter((file) => {
    const last = runs.find((run) => run.units.some((unit) => unit.file === file))
    if (last === undefined || !last.units.find((unit) => unit.file === file).passed) return true
    const changed = changedSince(last.commit)
    if (changed === undefined) return true
    const reached = closure(file)
    return changed.some((path) => reached.has(path) || EVERYTHING.includes(path))
  })
}

/** The package budget outcomes perf.mjs printed in `log`. */
export function unitOutcomes(log) {
  return log.split('\n').map((line) => /juno-perf-unit: (\{.*\})\s*$/.exec(line)?.[1]).filter(Boolean).map((json) => JSON.parse(json))
}
