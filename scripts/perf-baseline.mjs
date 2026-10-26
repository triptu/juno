// The laptop's perf baseline (docs/performance.md 7.3): every budgeted
// metric's lower quartile over several laptop runs of the same code, which
// later runs are checked against by the rule in
// packages/testing/src/perfRule.ts: the median of the runs, the fastest and
// the slowest.
//
//   bun scripts/perf-baseline.mjs update [<results dir>...]
//       Writes apps/desktop/e2e/perf-baseline.json from the perf-metrics.json
//       files the runs left, by runner shape (default: the two newest
//       .remote/<run> with any). Name runs at different host loads, one on
//       a quiet laptop and one beside another job: the load moves the
//       numbers most. Two runs are enough to start; more, added over time,
//       tighten the spread. Shapes and metrics the runs did not measure keep
//       their old values. Only on request, or after a change that moves a
//       number on purpose: a baseline refreshed every night would let a slow
//       creep through.
//   bun scripts/perf-baseline.mjs show [<results dir>...]
//       Prints each metric against the baseline without writing.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STEADY } from '../packages/testing/src/perfRule.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const BASELINE = join(root, 'apps/desktop/e2e/perf-baseline.json')

/** Every perf-metrics.json under `dir`. */
export function metricFiles(dir) {
  return readdirSync(dir, { recursive: true }).map(String).filter((file) => file.endsWith('perf-metrics.json')).map((file) => join(dir, file))
}

/** The newest `count` `.remote/<run>` folders that hold perf metrics. */
function newestRuns(count) {
  const remote = join(root, '.remote')
  const runs = existsSync(remote) ? readdirSync(remote).map((name) => join(remote, name)).filter((dir) => statSync(dir).isDirectory()) : []
  const found = runs.toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).filter((dir) => metricFiles(dir).length > 0).slice(0, count)
  if (found.length === 0) throw new Error('No perf-metrics.json under .remote; run `bun run remote perf` first, or name results folders.')
  return found
}

/** One run's metrics by runner shape, then by name: a nightly's parts run on jobs of different sizes. */
export function readRun(files) {
  const shapes = {}
  for (const entry of files.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')))) {
    shapes[entry.identity] = { ...shapes[entry.identity], [entry.name]: { low: entry.low, median: entry.median, p95: entry.p95, n: entry.n, unit: entry.unit } }
  }
  return shapes
}

const middle = (values) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) / 2)]

/**
 * The baseline after `runs` (readRun each), over the old one: per shape and
 * metric the median, fastest and slowest of their lower quartiles, and the
 * median of their medians and p95s. Shapes and metrics the runs did not
 * measure keep their old values.
 */
export function merged(old, runs, commit, recorded) {
  const shapes = { ...old?.shapes }
  for (const identity of new Set(runs.flatMap((run) => Object.keys(run)))) {
    const seenIn = runs.flatMap((run) => run[identity] === undefined ? [] : [run[identity]])
    const names = [...new Set(seenIn.flatMap((metrics) => Object.keys(metrics)))]
    const measured = Object.fromEntries(names.map((name) => {
      const seen = seenIn.flatMap((metrics) => metrics[name] === undefined ? [] : [metrics[name]])
      const lows = seen.map((metric) => metric.low)
      return [name, { low: middle(lows), fastest: Math.min(...lows), slowest: Math.max(...lows), median: middle(seen.map((metric) => metric.median)), p95: middle(seen.map((metric) => metric.p95)), runs: seen.length, n: seen[0].n, unit: seen[0].unit }]
    }))
    const metrics = Object.fromEntries(Object.entries({ ...shapes[identity]?.metrics, ...measured }).toSorted(([a], [b]) => a.localeCompare(b)))
    shapes[identity] = { runs: seenIn.length, metrics }
  }
  return { commit, recorded, shapes: Object.fromEntries(Object.entries(shapes).toSorted(([a], [b]) => a.localeCompare(b))) }
}

if (import.meta.main) {
  const [command, ...dirs] = process.argv.slice(2)
  if (command !== 'update' && command !== 'show') throw new Error('usage: bun scripts/perf-baseline.mjs update|show [<results dir>...]')
  const runs = (dirs.length === 0 ? newestRuns(2) : dirs.map((dir) => resolve(dir))).map((dir) => readRun(metricFiles(dir)))
  const old = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : undefined
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const next = merged(old, runs, commit, new Date().toISOString().slice(0, 10))
  for (const [identity, shape] of Object.entries(next.shapes)) {
    console.log(`${identity}, ${shape.runs} runs:`)
    for (const [name, metric] of Object.entries(shape.metrics)) {
      const base = old?.shapes?.[identity]?.metrics[name]
      const spread = metric.slowest / metric.fastest
      console.log(`  ${name}: lower quartile ${metric.low.toFixed(1)} ${metric.unit} (${metric.fastest.toFixed(1)} to ${metric.slowest.toFixed(1)}${spread > STEADY ? ', not steady' : ''})${base?.low === undefined ? ', new' : `; was ${base.low.toFixed(1)}`}`)
    }
  }
  if (command === 'update') {
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`perf-baseline: ${runs.length} runs, ${Object.keys(next.shapes).length} runner shapes; commit apps/desktop/e2e/perf-baseline.json`)
  }
}
