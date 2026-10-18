// Runs several root scripts on one machine, for `pnpm affected` and
// `pnpm verify:main`:
//
//   pnpm remote test:plan test --passWithNoTests a.test.ts + GALLERY_SHIFT_ONLY=Chip test:gallery + test:desktop
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
import { availableParallelism } from 'node:os'
import { createInterface } from 'node:readline'
import { forwardSignals } from './remote/children.mjs'

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

export const appSuites = ['test:desktop', 'test:gallery', 'test:e2e']
/** The steps in lanes that run at the same time; each lane runs its steps in order. */
export function lanes(steps, serial) {
  if (serial) return [steps]
  const app = steps.filter((step) => appSuites.includes(step.script))
  const specs = steps.filter((step) => step.script === 'specs:check')
  const rest = steps.filter((step) => !appSuites.includes(step.script) && step.script !== 'specs:check')
  return [app, rest, specs].filter((lane) => lane.length > 0)
}

/**
 * Split the reservation between app workers (half the cores), unit workers
 * and simulations (a quarter each), plus one uncached Apalache checker.
 * Gallery gets three quarters because its checks wait for the browser.
 * A step's own KEY=VALUE words still win.
 */
export function sideBySide(cores) {
  const galleryWorkers = String(Math.max(1, Math.floor((cores * 3) / 4)))
  return {
    app: { JUNO_E2E_WORKERS: String(Math.max(1, Math.floor(cores / 2))), GALLERY_WORKERS: galleryWorkers, GALLERY_SHIFT_PARTS: galleryWorkers },
    rest: { JUNO_VITEST_WORKERS: String(Math.max(1, Math.floor(cores / 4))), JUNO_TEST_PACKAGE_JOBS: '1' },
    specs: { SPECS_JOBS: String(Math.max(1, Math.floor(cores / 4))), SPECS_APALACHE: '1' },
  }
}

if (import.meta.main) {
  let steps
  try {
    steps = parsePlan(process.argv.slice(2))
  } catch (error) {
    console.error(`plan: ${error.message}`)
    console.error('usage: pnpm test:plan [KEY=VALUE...] <script> [args...] [+ [KEY=VALUE...] <script> [args...]]...')
    process.exit(2)
  }
  const children = new Set()
  forwardSignals(children)
  const serial = process.env.JUNO_PLAN_SERIAL === '1'
  const planned = lanes(steps, serial)
  const cores = Number(process.env.JUNO_RUNNER_JOB_CORES) || availableParallelism()
  const shared = planned.length > 1 ? sideBySide(cores) : undefined
  const run = (step, low) =>
    new Promise((resolvePromise) => {
      const started = Date.now()
      const command = low ? ['nice', ['-n', '10', 'pnpm', step.script, ...step.args]] : ['pnpm', [step.script, ...step.args]]
      const laneEnv = appSuites.includes(step.script) ? shared?.app : step.script === 'specs:check' ? shared?.specs : shared?.rest
      const child = spawn(command[0], command[1], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...laneEnv, ...step.env, JUNO_HEAVY_HELD: '1' } })
      children.add(child)
      const prefix = `[${step.script}] `
      for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) createInterface({ input: stream }).on('line', (line) => out.write(prefix + line + '\n'))
      child.on('error', () => {})
      child.on('close', (code) => {
        children.delete(child)
        const result = code ?? 1
        console.log(`plan: step ${steps.indexOf(step)} ${step.script} exited with ${result} after ${Math.round((Date.now() - started) / 1000)} s`)
        resolvePromise(result)
      })
    })
  console.log(`plan: ${steps.length} step(s) in ${planned.length} lane(s): ${planned.map((lane) => lane.map((step) => step.script).join(', ')).join(' | ')}`)
  const codes = (await Promise.all(planned.map(async (lane, index) => {
    const results = []
    // The unit and spec lanes give priority to the app lane.
    for (const step of lane) results.push(await run(step, index > 0 && planned.length > 1))
    return results
  }))).flat()
  process.exit(codes.every((code) => code === 0) ? 0 : 1)
}
