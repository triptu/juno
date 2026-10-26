// The laptop's perf baseline (docs/performance.md 7.3): every budgeted
// metric's lower quartile over a few laptop runs of the same code, each
// scaled to the runs' median job speed, which later runs are checked against
// by the rule in packages/testing/src/perfRule.ts: the median of the runs,
// the fastest and the slowest.
//
//   bun scripts/perf-baseline.mjs update [<results dir>...]
//       Writes apps/desktop/e2e/perf-baseline.json from the perf-metrics.json
//       files the runs left (default: the five newest .remote/<run> with
//       any). Name runs at different host loads: the load moves the numbers
//       most. Metrics the runs did not measure keep their old values. Only on
//       request, or after a change that moves a number on purpose: a baseline
//       refreshed every night would let a slow creep through.
//   bun scripts/perf-baseline.mjs show [<results dir>...]
//       Prints each metric against the baseline without writing.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaled, STEADY } from '../packages/testing/src/perfRule.ts'

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

/** One run's metrics by name; a run has one runner identity. */
export function readRun(files) {
  const entries = files.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')))
  const identities = new Set(entries.map((entry) => entry.identity))
  if (identities.size > 1) throw new Error(`The results come from several runner shapes: ${[...identities].join('; ')}`)
  return { identity: entries[0]?.identity, metrics: Object.fromEntries(entries.map((entry) => [entry.name, { low: entry.low, speed: entry.speed, median: entry.median, p95: entry.p95, n: entry.n, unit: entry.unit }])) }
}

const middle = (values) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) / 2)]

/**
 * The baseline after `runs` (readRun each, one shape), over the old metrics:
 * per metric the median job speed, the median, fastest and slowest of the
 * lower quartiles scaled to it, and the median of the medians and p95s.
 */
export function merged(old, runs, commit, recorded) {
  const identity = runs[0].identity
  if (runs.some((run) => run.identity !== identity)) throw new Error('The runs come from several runner shapes')
  const names = [...new Set(runs.flatMap((run) => Object.keys(run.metrics)))]
  const measured = Object.fromEntries(names.map((name) => {
    const seen = runs.flatMap((run) => run.metrics[name] === undefined ? [] : [run.metrics[name]])
    const speed = middle(seen.map((metric) => metric.speed))
    const lows = seen.map((metric) => scaled(metric.low, metric.unit, metric.speed, speed))
    return [name, { low: middle(lows), fastest: Math.min(...lows), slowest: Math.max(...lows), speed, median: middle(seen.map((metric) => metric.median)), p95: middle(seen.map((metric) => metric.p95)), runs: seen.length, n: seen[0].n, unit: seen[0].unit }]
  }))
  const kept = old?.identity === identity ? old.metrics : {}
  return { identity, commit, recorded, runs: runs.length, metrics: Object.fromEntries(Object.entries({ ...kept, ...measured }).toSorted(([a], [b]) => a.localeCompare(b))) }
}

if (import.meta.main) {
  const [command, ...dirs] = process.argv.slice(2)
  if (command !== 'update' && command !== 'show') throw new Error('usage: bun scripts/perf-baseline.mjs update|show [<results dir>...]')
  const runs = (dirs.length === 0 ? newestRuns(5) : dirs.map((dir) => resolve(dir))).map((dir) => readRun(metricFiles(dir)))
  const old = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : undefined
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const next = merged(old, runs, commit, new Date().toISOString().slice(0, 10))
  for (const [name, metric] of Object.entries(next.metrics)) {
    const base = old?.identity === next.identity ? old.metrics[name] : undefined
    const spread = metric.slowest / metric.fastest
    console.log(`${name}: lower quartile ${metric.low.toFixed(1)} ${metric.unit} (${metric.fastest.toFixed(1)} to ${metric.slowest.toFixed(1)}${spread > STEADY ? ', not steady' : ''})${base?.low === undefined ? ', new' : `; was ${base.low.toFixed(1)}`}`)
  }
  if (command === 'update') {
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`perf-baseline: ${Object.keys(next.metrics).length} metrics from ${runs.length} runs for ${next.identity}; commit apps/desktop/e2e/perf-baseline.json`)
  }
}
