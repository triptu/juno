// Runs several root scripts on one machine, for `bun run affected` and
// `bun run verify:main`:
//
//   bun run remote test:plan test --passWithNoTests a.test.ts + GALLERY_SHIFT_ONLY=Chip test:gallery + test:desktop
//
// Steps are separated by `+`. `KEY=VALUE` words before a step's script set its
// environment. The app suites (test:desktop, test:gallery, test:e2e) run one
// after another, each with the whole machine's workers. The other suites (unit
// tests and spec checks) run in separate lanes beside them, at a lower CPU
// priority, so the app suites keep their timing. JUNO_PLAN_SERIAL=1 runs every
// step one after another instead.
//
// The plan owns the machine, so its steps skip the heavy-job queue
// (scripts/heavy.mjs). Inside a remote container a build is reused by later
// steps (scripts/build-cached.mjs), so the desktop app is built once per run.
// Each output line starts with `[<script>] `. After each step a line
// `plan: step <index> <script> exited with <code> after <seconds> s` gives its
// result; the exit code is 1 if any step failed.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { availableParallelism, loadavg } from 'node:os'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import { runtimeIdentity } from './verify-inputs.mjs'
import { failureMonitor } from './verify-failures.mjs'

export function parsePlan(argv) {
  const steps = []
  let current = { env: {}, script: undefined, args: [] }
  const finish = () => {
    if (!current.script) throw new Error('every step needs a script')
    steps.push(current)
    current = { env: {}, script: undefined, args: [] }
  }
  for (const word of argv) {
    if (word === '+') finish()
    else if (!current.script && /^[A-Z_][A-Z0-9_]*=/.test(word)) current.env[word.slice(0, word.indexOf('='))] = word.slice(word.indexOf('=') + 1)
    else if (!current.script) current.script = word
    else current.args.push(word)
  }
  finish()
  for (const step of steps) if (step.script === 'test:plan') throw new Error('a plan cannot contain test:plan')
  return steps
}

// The job's cgroup (remote containers): CPU time used and memory now, or undefined elsewhere.
const cgroupRead = (file, pick) => { try { return pick(readFileSync(`/sys/fs/cgroup/${file}`, 'utf8')) } catch { return undefined } }
const cpuMicros = () => cgroupRead('cpu.stat', (text) => Number(/^usage_usec (\d+)$/m.exec(text)?.[1]))
const memoryBytes = () => cgroupRead('memory.current', Number)

export const appSuites = ['test:desktop', 'test:browser', 'test:electron', 'test:nightly', 'test:gallery', 'test:e2e']
/** The steps in lanes that run at the same time; each lane runs its steps in order. */
export function lanes(steps, serial) {
  if (serial) return [steps]
  const app = steps.filter((step) => appSuites.includes(step.script))
  const specs = steps.filter((step) => step.script === 'specs:check')
  const rest = steps.filter((step) => !appSuites.includes(step.script) && step.script !== 'specs:check')
  return [app, rest, specs].filter((lane) => lane.length > 0)
}

/**
 * Split the CPU limit between app workers (half the cores), unit workers
 * and simulations (a quarter each), plus one uncached Apalache checker.
 * Gallery gets three quarters because its checks wait for the browser.
 * Wide unit-only plans retain their inherited unit workers; app plans split them.
 * A step's own KEY=VALUE words still win.
 */
export function sideBySide(cores, wideUnit = false) {
  const galleryWorkers = String(cores === 3 ? 3 : Math.max(1, Math.floor((cores * 3) / 4)))
  return {
    app: { JUNO_E2E_WORKERS: String(Math.max(1, Math.floor(cores / 2))), GALLERY_WORKERS: galleryWorkers, GALLERY_SHIFT_PARTS: galleryWorkers },
    rest: wideUnit ? {} : { JUNO_TEST_WORKERS: String(Math.max(1, Math.floor(cores / 4))) },
    specs: { SPECS_JOBS: String(Math.max(1, Math.floor(cores / 4))), SPECS_APALACHE: '1' },
  }
}

if (import.meta.main) {
  let steps
  try {
    steps = parsePlan(process.argv.slice(2))
  } catch (error) {
    console.error(`plan: ${error.message}`)
    console.error('usage: bun run test:plan [KEY=VALUE...] <script> [args...] [+ [KEY=VALUE...] <script> [args...]]...')
    process.exit(2)
  }
  const children = new Set()
  let stopRun = false
  const identity = runtimeIdentity(process.cwd())
  console.log(`juno-runtime: ${JSON.stringify(identity)}`)
  const guarded = process.env.JUNO_VERIFY_POLICY === '1'
  const stopChild = (child, signal) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      if (guarded && process.platform !== 'win32') process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => {
    stopRun = true
    process.exitCode = 130
    for (const child of children) stopChild(child, signal)
  })
  const serial = process.env.JUNO_PLAN_SERIAL === '1'
  const planned = lanes(steps, serial)
  const cores = Number(process.env.JUNO_RUNNER_JOB_CORES) || availableParallelism()
  const shared = planned.length > 1 ? sideBySide(cores, process.env.JUNO_RUNNER_WIDE_UNIT === '1') : undefined
  const run = (step, low) =>
    new Promise((resolvePromise) => {
      const started = Date.now()
      // Per-step CPU and memory, for sizing jobs (docs/development.md, "Full runs"). Steps in one lane
      // run alone, so the job's cgroup counts only this step.
      const cpuStart = planned.length === 1 ? cpuMicros() : undefined
      let peak = memoryBytes() ?? 0
      const sampler = cpuStart === undefined ? undefined : setInterval(() => { peak = Math.max(peak, memoryBytes() ?? 0) }, 1000)
      const monitor = failureMonitor()
      let stopped
      const command = low ? ['nice', ['-n', '10', 'bun', 'run', step.script, ...step.args]] : ['bun', ['run', step.script, ...step.args]]
      const laneEnv = appSuites.includes(step.script) ? shared?.app : step.script === 'specs:check' ? shared?.specs : shared?.rest
      const child = spawn(command[0], command[1], { detached: guarded && process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...laneEnv, ...step.env, JUNO_HEAVY_HELD: '1', JUNO_PLAN_STEP: String(steps.indexOf(step)) } })
      children.add(child)
      const prefix = `[${step.script}] `
      console.log(`${prefix}juno-runtime: ${JSON.stringify(identity)}`)
      const stop = (reason) => {
        if (stopped) return
        stopped = reason
        stopRun ||= reason.scope === 'run'
        console.log(`${prefix}juno-stop: ${JSON.stringify(reason)}`)
        stopChild(child, 'SIGTERM')
      }
      for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) createInterface({ input: stream }).on('line', (line) => {
        out.write(prefix + line + '\n')
        const reason = guarded ? monitor.line(line) : undefined
        if (reason) stop(reason)
      })
      child.on('error', () => {})
      child.on('close', (code) => {
        children.delete(child)
        clearInterval(sampler)
        if (cpuStart !== undefined) console.log(`plan: step ${steps.indexOf(step)} ${step.script} used ${Math.round((cpuMicros() - cpuStart) / 1e6)} CPU-s, peak memory ${(peak / 2 ** 30).toFixed(1)} GB (includes file cache)`)
        if (guarded && code !== 0 && !stopped && monitor.completed === 0 && /^test(?::|$)/.test(step.script)) stop({ scope: 'run', rule: 'setup', signature: `${step.script} exited before any tests completed`, completed: 0, failed: 0 })
        const result = stopped ? 1 : code ?? 1
        console.log(`plan: step ${steps.indexOf(step)} ${step.script} exited with ${result} after ${Math.round((Date.now() - started) / 1000)} s`)
        resolvePromise(result)
      })
    })
  console.log(`plan: ${steps.length} step(s) in ${planned.length} lane(s): ${planned.map((lane) => lane.map((step) => step.script).join(', ')).join(' | ')}`)
  const codes = (await Promise.all(planned.map(async (lane, index) => {
    const results = []
    // The unit and spec lanes give priority to the app lane.
    for (const step of lane) {
      if (stopRun) break
      // The local full run owns the lock, but unrelated processes may still be busy.
      if (serial) {
        while (loadavg()[0] > Number(process.env.JUNO_PLAN_MAX_LOAD ?? Infinity)) {
          console.log(`plan: load ${loadavg()[0].toFixed(1)} is above ${process.env.JUNO_PLAN_MAX_LOAD}; waiting before ${step.script}`)
          await sleep(30_000)
        }
      }
      results.push(await run(step, index > 0 && planned.length > 1))
    }
    return results
  }))).flat()
  process.exit(codes.every((code) => code === 0) ? 0 : 1)
}
