// Runs several root scripts on one machine, for `bun run affected` and
// `bun run verify:main`:
//
//   bun run remote test:plan test --passWithNoTests a.test.ts + GALLERY_SHIFT_ONLY=Chip test:gallery + test:desktop
//
// Steps are separated by `+`. `KEY=VALUE` words before a step's script set its
// environment. The app suites (test:desktop, test:gallery, test:e2e) run one
// after another, each with the whole machine's workers. The other suites (unit
// tests and spec checks) run in separate lanes beside them, at a lower CPU
// priority, so the app suites keep their timing. test:electron runs in a lane
// of its own beside test:browser, also at the lower priority. The lanes share the workers
// out (sideBySide below); JUNO_PLAN_OVERLAP=1 keeps each suite's own workers.
// JUNO_PLAN_SERIAL=1 runs every step one after another instead.
//
// The plan owns the machine, so its steps skip the heavy-job queue
// (scripts/heavy.mjs). Inside a remote container a build is reused by later
// steps (scripts/build-cached.mjs), so the desktop app is built once per run.
// Each output line starts with `[<script>] `. After each step a line
// `plan: step <index> <script> exited with <code> after <seconds> s` gives its
// result (in a remote container, after a line with the CPU its processes used);
// the exit code is 1 if any step failed.

import { spawn, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { availableParallelism, cpus, loadavg } from 'node:os'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import { runtimeIdentity, toolchainIdentity } from './verify-inputs.mjs'
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

/**
 * Linux: the CPU each step's processes used, sampled each second and found by the JUNO_PLAN_STEP they inherit. A
 * process without it (Chromium's zygote and renderers start with a cleared environment) counts for its parent's step.
 * Processes a step leaves to the container's init (the DOM lane's pooled hosts) count too, which a process tree's
 * accounting misses; a process's last second and processes shorter than a second do not.
 */
function processCpu() {
  if (process.platform !== 'linux') return undefined
  const seen = new Map()
  const sample = () => {
    const running = new Map()
    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'latin1')
        // After the command's closing parenthesis: ppid is field 1, utime 11, stime 12, start time 19 (clock ticks).
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        running.set(pid, { key: `${pid} ${fields[19]}`, parent: fields[1], ticks: Number(fields[11]) + Number(fields[12]) })
      } catch { /* the process ended */ }
    }
    const stepOf = (pid, depth = 0) => {
      const entry = running.get(pid)
      if (!entry || depth > 32) return null
      if (!seen.has(entry.key)) {
        let step
        try { step = /(?:^|\0)JUNO_PLAN_STEP=(\d+)\0/.exec(readFileSync(`/proc/${pid}/environ`, 'latin1'))?.[1] } catch { /* hidden */ }
        seen.set(entry.key, { step: step ?? stepOf(entry.parent, depth + 1), ticks: 0 })
      }
      return seen.get(entry.key).step
    }
    for (const [pid, entry] of running) {
      stepOf(pid)
      seen.get(entry.key).ticks = entry.ticks
    }
  }
  sample()
  // Linux reports CPU in USER_HZ, 100 a second on the runner's architectures.
  const used = (index) => [...seen.values()].reduce((sum, entry) => entry.step === String(index) ? sum + entry.ticks : sum, 0) / 100
  return { sample, used }
}

/**
 * Cores kept busy over the last `millis`, from every core's time counters. A serial plan checks this before a step
 * instead of the 1-minute load average, which after a step stays high for a minute or more though nothing runs:
 * on 10-27 a local full run waited about 245 s for the load its own steps had left to decay below 8.
 */
export async function busyCores(millis = 2000) {
  const total = () => cpus().reduce((sum, { times }) => {
    const busy = times.user + times.nice + times.sys + times.irq
    return { busy: sum.busy + busy, all: sum.all + busy + times.idle }
  }, { busy: 0, all: 0 })
  const before = total()
  await sleep(millis)
  const after = total()
  return after.all > before.all ? (after.busy - before.busy) / (after.all - before.all) * cpus().length : 0
}

/** The processes left in a step's process group after its command exited: pid and command. */
export function groupMembers(group) {
  const listed = spawnSync('ps', ['-A', '-o', 'pid=,pgid=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 })
  return (listed.stdout ?? '').split('\n').map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match && Number(match[2]) === group).map((match) => ({ pid: Number(match[1]), command: match[3] }))
}

export const appSuites = ['test:desktop', 'test:browser', 'test:electron', 'test:gallery', 'test:e2e']
/** The steps in lanes that run at the same time; each lane runs its steps in order. */
export function lanes(steps, serial) {
  if (serial) return [steps]
  // With the browser lane in the plan, Electron runs beside it at the side lanes' lower priority: the browser
  // lane leaves about a third of the threads idle while its tests wait on frames (docs/development.md, "Job sizes").
  const electron = steps.some((step) => step.script === 'test:browser') ? steps.filter((step) => step.script === 'test:electron') : []
  const app = steps.filter((step) => appSuites.includes(step.script) && !electron.includes(step))
  const specs = steps.filter((step) => step.script === 'specs:check')
  const rest = steps.filter((step) => !appSuites.includes(step.script) && step.script !== 'specs:check')
  return [app, electron, rest, specs].filter((lane) => lane.length > 0)
}

/**
 * Split the CPU limit between app workers (half the cores), unit workers
 * and simulations (a quarter each), plus one uncached Apalache checker.
 * Gallery gets three quarters because its checks wait for the browser, and a
 * quarter when it walks only changed states (apps/gallery/playwright.config.ts).
 * Wide unit-only plans retain their inherited unit workers; app plans split them.
 * The browser and Electron lanes side by side take half and a third of the
 * threads: on three cores (six threads) 3 and 2 workers finished in 115 s and
 * 591 CPU-s, 4 and 3 in 116 s and 657 (10-26, one run each).
 * A step's own KEY=VALUE words still win.
 */
export function sideBySide(cores, wideUnit = false) {
  const galleryWorkers = String(cores === 3 ? 3 : Math.max(1, Math.floor((cores * 3) / 4)))
  return {
    app: { JUNO_E2E_WORKERS: String(Math.max(1, Math.floor(cores / 2))), GALLERY_WORKERS: galleryWorkers, GALLERY_FAST_WORKERS: galleryWorkers, GALLERY_CACHED_WORKERS: String(Math.max(1, Math.floor(cores / 4))) },
    desktop: { JUNO_BROWSER_WORKERS: String(Math.max(1, Math.floor(cores / 2))), JUNO_E2E_WORKERS: String(Math.max(1, Math.floor(cores / 3))) },
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
  console.log(`juno-toolchain: ${JSON.stringify(toolchainIdentity(process.cwd()))}`)
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
  // JUNO_PLAN_OVERLAP=1 (a split SSH job outside full runs) keeps every lane's own workers.
  const shared = planned.length > 1 && process.env.JUNO_PLAN_OVERLAP !== '1' ? sideBySide(cores, process.env.JUNO_RUNNER_WIDE_UNIT === '1') : undefined
  console.log(`plan: ${steps.length} step(s) in ${planned.length} lane(s): ${planned.map((lane) => lane.map((step) => step.script).join(', ')).join(' | ')}`)
  // CPU and memory for sizing jobs (docs/development.md, "Job sizes"): each step's from its processes, the job's
  // from its cgroup, so the gap shows what no step's processes accounted for.
  const planCpuStart = cpuMicros()
  const processes = processCpu()
  const memory = { job: memoryBytes() ?? 0, steps: new Map() }
  const sampler = planCpuStart === undefined ? undefined : setInterval(() => {
    processes?.sample()
    const now = memoryBytes() ?? 0
    memory.job = Math.max(memory.job, now)
    for (const [step, peak] of memory.steps) memory.steps.set(step, Math.max(peak, now))
  }, 1000)
  const gigabytes = (bytes) => (bytes / 2 ** 30).toFixed(1)
  const run = (step, low) =>
    new Promise((resolvePromise) => {
      const started = Date.now()
      const index = steps.indexOf(step)
      memory.steps.set(index, memoryBytes() ?? 0)
      const monitor = failureMonitor()
      let stopped
      const command = low ? ['nice', ['-n', '10', 'bun', 'run', step.script, ...step.args]] : ['bun', ['run', step.script, ...step.args]]
      const desktopBeside = planned.some((lane) => lane[0]?.script === 'test:electron') && ['test:browser', 'test:electron'].includes(step.script)
      const laneEnv = appSuites.includes(step.script) ? { ...shared?.app, ...(desktopBeside ? shared?.desktop : {}) } : step.script === 'specs:check' ? shared?.specs : shared?.rest
      // JUNO_PLAN_STEP marks the step's processes for processCpu.
      // A lane at the lower priority gets the CPU the app lane leaves, and twice its tests' limit (@juno/testing/limits).
      const beside = low ? { JUNO_TEST_TIME_SCALE: '2' } : {}
      const child = spawn(command[0], command[1], { detached: guarded && process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...laneEnv, ...beside, ...step.env, JUNO_HEAVY_HELD: '1', JUNO_PLAN_STEP: String(index) } })
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
      child.on('close', async (code) => {
        children.delete(child)
        // A serial plan runs the next step on a quiet machine: nothing of this step may outlive it. Pooled hosts exit
        // when their worker goes away, so allow a few seconds; then name what is left and stop it.
        if (serial && guarded && process.platform === 'darwin' && child.pid) {
          for (let waited = 0; waited < 5000 && groupMembers(child.pid).length > 0; waited += 250) await sleep(250)
          const left = groupMembers(child.pid)
          if (left.length > 0) {
            console.log(`plan: step ${index} ${step.script} left ${left.length} process(es) running; stopping them: ${left.map(({ pid, command }) => `${pid} ${command.slice(0, 120)}`).join('; ')}`)
            try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
          }
        }
        if (processes) {
          processes.sample()
          console.log(`plan: step ${index} ${step.script} used ${Math.round(processes.used(index))} CPU-s, job memory peaked at ${gigabytes(memory.steps.get(index))} GB while it ran (includes file cache)`)
        }
        memory.steps.delete(index)
        if (guarded && code !== 0 && !stopped && monitor.completed === 0 && /^test(?::|$)/.test(step.script)) stop({ scope: 'run', rule: 'setup', signature: `${step.script} exited before any tests completed`, completed: 0, failed: 0 })
        const result = stopped ? 1 : code ?? 1
        console.log(`plan: step ${index} ${step.script} exited with ${result} after ${Math.round((Date.now() - started) / 1000)} s`)
        resolvePromise(result)
      })
    })
  const codes = (await Promise.all(planned.map(async (lane, index) => {
    const results = []
    // The unit and spec lanes give priority to the app lane.
    for (const step of lane) {
      if (stopRun) break
      // The local full run owns the lock, but unrelated processes may still be busy. The 1-minute load is a cheap
      // first look; above the core count, the cores busy right now say whether that is other work or the tail of
      // this plan's last step.
      if (serial) {
        const most = Number(process.env.JUNO_PLAN_MAX_BUSY ?? Infinity)
        while (Number.isFinite(most) && loadavg()[0] > cpus().length) {
          const busy = await busyCores()
          if (busy <= most) break
          console.log(`plan: other work keeps ${busy.toFixed(1)} cores busy, more than ${most}; waiting before ${step.script}`)
          await sleep(10_000)
        }
      }
      results.push(await run(step, index > 0 && planned.length > 1))
    }
    return results
  }))).flat()
  clearInterval(sampler)
  if (planCpuStart !== undefined) {
    const used = Math.round((cpuMicros() - planCpuStart) / 1e6)
    const counted = processes ? `, ${used - Math.round(steps.reduce((sum, _, index) => sum + processes.used(index), 0))} of them outside its steps' processes` : ''
    console.log(`plan: the job used ${used} CPU-s${counted}, peak memory ${gigabytes(memory.job)} GB (includes file cache)`)
  }
  process.exit(codes.every((code) => code === 0) ? 0 : 1)
}
