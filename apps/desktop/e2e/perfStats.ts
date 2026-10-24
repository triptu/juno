import { execFileSync } from 'node:child_process'
import { loadavg } from 'node:os'
import { resolve } from 'node:path'
import { Worker } from 'node:worker_threads'

const ROOT = resolve(__dirname, '../../..')

/**
 * Other checkouts' Electron and Playwright processes running now. The
 * heavy-job lock only holds back runs that take it; one that launches the
 * app directly still shares the machine, and its frames and timers change
 * these numbers. Printed with every result, so a contended number is never
 * read as a clean one.
 */
export function contention(): string {
  let listing = ''
  try {
    listing = execFileSync('ps', ['-Ao', 'command'], { encoding: 'utf8' })
  } catch {
    return ''
  }
  const others = new Set<string>()
  for (const line of listing.split('\n')) {
    // A checkout's own Electron app running: a queued or idle test runner is no load.
    const program = line.split(' ')[0] ?? ''
    if (!program.includes('/node_modules/') || !program.includes('/electron/dist/')) continue
    // Electron runs from Bun's shared store, so the checkout is the app path in the
    // arguments. The main and renderer processes carry it; helpers without it are skipped.
    const app = line.match(/(\/[^\s=]*\/([^/ ]+))\/apps\/desktop(?:\s|$)/)
    if (app === null || app[1] === ROOT) continue
    others.add(app[2]!)
  }
  return others.size === 0 ? '' : `, contended by ${[...others].join(', ')}`
}

export function stats(name: string, samples: ReadonlyArray<number>): { readonly median: number; readonly p95: number } {
  if (samples.length === 0) throw new Error(`${name}: no performance samples`)
  const sorted = samples.toSorted((a, b) => a - b)
  // Nearest rank: the p95 of 20 samples is the 19th, not the largest.
  const at = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0
  const median = at(0.5)
  const p95 = at(0.95)
  const load = loadavg()[0]!.toFixed(1)
  const shown = sorted.length <= 60 ? `, samples ${sorted.map((s) => s.toFixed(1)).join(' ')}` : ''
  console.log(`${name}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, n=${samples.length}, load ${load}${contention()}${shown}`)
  return { median, p95 }
}

/**
 * Keep two cores busy without changing the renderer's workload, so the CPU
 * clock stays up (performance.md 7.3). Returns the function that stops them.
 */
export async function holdClock(): Promise<() => Promise<void>> {
  const workers = Array.from({ length: 2 }, () => new Worker(`
    const { parentPort } = require('node:worker_threads')
    parentPort.postMessage('ready')
    for (;;) Math.sqrt(Math.random())
  `, { eval: true }))
  try {
    await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
      worker.once('message', () => resolve())
      worker.once('error', reject)
    })))
  } catch (error) {
    await Promise.all(workers.map((worker) => worker.terminate()))
    throw error
  }
  return async () => { await Promise.all(workers.map((worker) => worker.terminate())) }
}

/**
 * A process's private memory in MB: macOS's physical footprint, which is
 * what `process.getProcessMemoryInfo().private` reports inside the process
 * on macOS (107,409 KB against a footprint of 105 MB on 10-18), the metric
 * of the memory budgets (performance.md 1). Read from outside, so no
 * process needs a hook for it. Undefined off macOS.
 */
export function privateMemory(pid: number): number | undefined {
  if (process.platform !== 'darwin') return undefined
  const out = execFileSync('/usr/bin/footprint', ['--noCategories', '-f', 'bytes', '-p', String(pid)], { encoding: 'utf8' })
  const bytes = /phys_footprint:\s+(\d+) B/.exec(out)?.[1]
  return bytes === undefined ? undefined : Number(bytes) / 1024 / 1024
}
