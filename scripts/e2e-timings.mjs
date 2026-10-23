#!/usr/bin/env bun
// Sums the `e2e-timing:` lines a desktop run prints under JUNO_E2E_TIMINGS=1
// (apps/desktop/e2e/timings.ts): where test time went, the slowest specs, and
// how busy each worker was. Usage: bun scripts/e2e-timings.mjs <run.log> [--top 15] [--json]
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg))
const top = Number(args[args.indexOf('--top') + 1]) || 15
if (file === undefined) {
  console.error('usage: bun scripts/e2e-timings.mjs <run.log> [--top 15] [--json]')
  process.exit(2)
}

const lines = readFileSync(file, 'utf8').split('\n')
const runs = lines.flatMap((line) => {
  const at = line.indexOf('e2e-timing: ')
  return at === -1 ? [] : [JSON.parse(line.slice(at + 'e2e-timing: '.length))]
})
const endLine = lines.find((line) => line.includes('e2e-timing-end: '))
const suiteMs = endLine === undefined ? Math.max(...runs.map((run) => run.start + run.ms)) : JSON.parse(endLine.slice(endLine.indexOf('e2e-timing-end: ') + 16)).ms

const sum = (values) => values.reduce((total, value) => total + value, 0)
const s = (ms) => Math.round(ms / 100) / 10
const totalMs = sum(runs.map((run) => run.ms))

const buckets = {}
const phases = {}
const phaseCounts = {}
for (const run of runs) {
  for (const [name, ms] of Object.entries(run.steps)) buckets[name] = (buckets[name] ?? 0) + ms
  for (const [name, ms] of Object.entries(run.phases)) {
    phases[name] = (phases[name] ?? 0) + ms
    phaseCounts[name] = (phaseCounts[name] ?? 0) + 1
  }
}

const specs = new Map()
for (const run of runs) {
  const spec = specs.get(run.file) ?? { file: run.file, tests: 0, ms: 0, start: Infinity, end: 0, sleep: 0, setup: 0 }
  spec.tests += 1
  spec.ms += run.ms
  spec.sleep += run.steps.sleep ?? 0
  spec.setup += (run.steps.before ?? 0) + (run.steps.after ?? 0) + (run.phases['sign-in'] ?? 0) + (run.phases.sync ?? 0)
  spec.start = Math.min(spec.start, run.start)
  spec.end = Math.max(spec.end, run.start + run.ms)
  specs.set(run.file, spec)
}

const workers = new Map()
for (const run of runs) {
  const worker = workers.get(run.worker) ?? { worker: run.worker, tests: 0, busy: 0, first: Infinity, last: 0 }
  worker.tests += 1
  worker.busy += run.ms
  worker.first = Math.min(worker.first, run.start)
  worker.last = Math.max(worker.last, run.start + run.ms)
  workers.set(run.worker, worker)
}

const summary = {
  suiteSeconds: s(suiteMs),
  testRuns: runs.length,
  retries: runs.filter((run) => run.retry > 0).length,
  summedTestSeconds: s(totalMs),
  firstTestStartSeconds: s(Math.min(...runs.map((run) => run.start))),
  buckets: Object.fromEntries(Object.entries(buckets).map(([name, ms]) => [name, s(ms)])),
  phases: Object.fromEntries(Object.entries(phases).map(([name, ms]) => [name, { seconds: s(ms), count: phaseCounts[name] }])),
  workers: [...workers.values()].sort((a, b) => a.worker - b.worker).map((worker) => ({ ...worker, busy: s(worker.busy), first: s(worker.first), last: s(worker.last), idle: s(suiteMs - worker.busy) })),
  slowestSpecs: [...specs.values()].sort((a, b) => b.ms - a.ms).slice(0, top).map((spec) => ({ file: spec.file, tests: spec.tests, summed: s(spec.ms), wall: s(spec.end - spec.start), setup: s(spec.setup), sleep: s(spec.sleep) })),
  slowestTests: [...runs].sort((a, b) => b.ms - a.ms).slice(0, top).map((run) => ({ file: run.file, title: run.title, seconds: s(run.ms), sleep: s(run.steps.sleep ?? 0) })),
}

if (args.includes('--json')) console.log(JSON.stringify(summary, null, 1))
else {
  console.log(`suite ${summary.suiteSeconds} s, ${summary.testRuns} test runs (${summary.retries} retries), ${summary.summedTestSeconds} s summed, first test at ${summary.firstTestStartSeconds} s`)
  console.log('buckets (s):', summary.buckets)
  console.log('phases:', summary.phases)
  console.table(summary.workers)
  console.table(summary.slowestSpecs)
  console.table(summary.slowestTests)
}
