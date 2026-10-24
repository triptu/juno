import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { statusFolder } from './release-gate.mjs'

/** Appends a step's duration to the main checkout's .juno-status/release-timings.json, for the repository at `cwd`. */
export function recordReleaseTiming(step, started, detail = {}, cwd = process.cwd()) {
  let file
  try { file = join(statusFolder(cwd), 'release-timings.json') } catch { file = join(statusFolder(resolve(import.meta.dirname, '..')), 'release-timings.json') }
  const finished = Date.now()
  let steps = []
  try { steps = JSON.parse(readFileSync(file, 'utf8')).steps ?? [] } catch { /* First step. */ }
  const entry = { step, startedAt: new Date(started).toISOString(), finishedAt: new Date(finished).toISOString(), seconds: Number(((finished - started) / 1000).toFixed(2)), ...detail }
  mkdirSync(resolve(file, '..'), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ steps: [...steps.slice(-99), entry] }, null, 2)}\n`)
  console.log(`release timing: ${step} ${entry.seconds.toFixed(2)} s${detail.status ? ` (${detail.status})` : ''}`)
}
