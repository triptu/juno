// The laptop's perf baseline (docs/performance.md 7.3): the median of every
// budgeted metric from one laptop run, which later runs are checked against.
//
//   bun scripts/perf-baseline.mjs update [<results dir>]
//       Writes apps/desktop/e2e/perf-baseline.json from the perf-metrics.json
//       files a run left (default: the newest .remote/<run> with any). Metrics
//       the run did not measure keep their old values. Only on request, or
//       after a change that moves a number on purpose: a baseline refreshed
//       every night would let a slow creep through.
//   bun scripts/perf-baseline.mjs show [<results dir>]
//       Prints each metric against the baseline without writing.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const BASELINE = join(root, 'apps/desktop/e2e/perf-baseline.json')

/** Every perf-metrics.json under `dir`. */
export function metricFiles(dir) {
  return readdirSync(dir, { recursive: true }).map(String).filter((file) => file.endsWith('perf-metrics.json')).map((file) => join(dir, file))
}

/** The newest `.remote/<run>` folder that holds perf metrics. */
function newestRun() {
  const remote = join(root, '.remote')
  const runs = existsSync(remote) ? readdirSync(remote).map((name) => join(remote, name)).filter((dir) => statSync(dir).isDirectory()) : []
  const found = runs.toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).find((dir) => metricFiles(dir).length > 0)
  if (found === undefined) throw new Error('No perf-metrics.json under .remote; run `bun run remote perf` first, or name a results folder.')
  return found
}

/** One run's metrics by name; a run has one runner identity. */
export function readRun(files) {
  const entries = files.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')))
  const identities = new Set(entries.map((entry) => entry.identity))
  if (identities.size > 1) throw new Error(`The results come from several runner shapes: ${[...identities].join('; ')}`)
  return { identity: entries[0]?.identity, metrics: Object.fromEntries(entries.map((entry) => [entry.name, { median: entry.median, p95: entry.p95, n: entry.n, unit: entry.unit }])) }
}

/** The baseline after `run`: its metrics over the old ones of the same shape. */
export function merged(old, run, commit, recorded) {
  const kept = old?.identity === run.identity ? old.metrics : {}
  return { identity: run.identity, commit, recorded, metrics: Object.fromEntries(Object.entries({ ...kept, ...run.metrics }).toSorted(([a], [b]) => a.localeCompare(b))) }
}

if (import.meta.main) {
  const [command, dir] = process.argv.slice(2)
  if (command !== 'update' && command !== 'show') throw new Error('usage: bun scripts/perf-baseline.mjs update|show [<results dir>]')
  const files = metricFiles(dir === undefined ? newestRun() : resolve(dir))
  const run = readRun(files)
  const old = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : undefined
  for (const [name, metric] of Object.entries(run.metrics)) {
    const base = old?.identity === run.identity ? old.metrics[name] : undefined
    console.log(`${name}: median ${metric.median.toFixed(1)}, p95 ${metric.p95.toFixed(1)} ${metric.unit}${base === undefined ? ', new' : `; baseline ${base.median.toFixed(1)}, ${base.p95.toFixed(1)}`}`)
  }
  if (command === 'update') {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    writeFileSync(BASELINE, `${JSON.stringify(merged(old, run, commit, new Date().toISOString().slice(0, 10)), null, 2)}\n`)
    console.log(`perf-baseline: ${Object.keys(run.metrics).length} metrics from ${files.length} files for ${run.identity}; commit apps/desktop/e2e/perf-baseline.json`)
  }
}
