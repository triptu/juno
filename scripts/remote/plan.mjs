// One SSH plan owns independent jobs through the shared tstack allocator.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parsePlan } from '../plan.mjs'
import { forwardSignals } from './children.mjs'

// Two four-core jobs that carry about the same measured CPU in a full run (docs/development.md,
// "Full runs"): the browser and Electron lanes, which share builds, with the spec checks; and the
// unit tests, the DOM lane and the gallery. Smaller jobs each left one long suite on too few cores.
// A release's nightly tests (test:nightly) join the desktop job, which has the builds.
const desktopJob = ['test:desktop', 'test:browser', 'test:electron', 'test:nightly', 'test:e2e', 'specs:check', 'specs:conformance']

export function runnerPlanJobs(options, env = process.env) {
  const setting = (key) => options.env?.findLast((pair) => pair.startsWith(`${key}=`))?.slice(key.length + 1) ?? env[key]
  if (options.script !== 'test:plan' || setting('JUNO_RUNNER_PLAN') === 'single' || setting('JUNO_PLAN_SERIAL') === '1') return []
  const steps = parsePlan(options.args)
  const groups = new Map()
  for (const [index, step] of steps.entries()) {
    const kind = desktopJob.includes(step.script) ? 'desktop' : 'unit'
    if (!groups.has(kind)) groups.set(kind, [])
    groups.get(kind).push({ ...step, index })
  }
  return groups.size > 1 ? [...groups].map(([kind, group]) => ({ kind, steps: group })) : []
}

export const planWords = (steps) => steps.flatMap((step, index) => [
  ...(index ? ['+'] : []), ...Object.entries(step.env).map(([key, value]) => `${key}=${value}`), step.script, ...step.args,
])

/** A unit job without the DOM lane or the gallery keeps the size its steps ask for (runnerJobSize). */
export const defaultPlanCores = (kind, steps) =>
  kind === 'desktop' || steps.some((step) => step.script === 'test:dom' || step.script === 'test:gallery') ? 4 : undefined

export function planCores(kind, options, env = process.env, steps = []) {
  const key = `JUNO_RUNNER_${kind.toUpperCase()}_CORES`
  const value = options.env.findLast((pair) => pair.startsWith(`${key}=`))?.slice(key.length + 1) ?? env[key]
  const cores = value === undefined ? options.cores ?? defaultPlanCores(kind, steps) : Number(value)
  if (cores !== undefined && (!Number.isInteger(cores) || cores < 1)) throw new Error(`${key} must be a positive whole number`)
  return cores
}

export async function runRunnerPlan(jobs, { self, root, options, log }) {
  const children = new Set()
  forwardSignals(children)
  let cancelled = false
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cancelled = true })
  log(`remote: SSH plan in ${jobs.length} jobs: ${jobs.map((job) => job.kind).join(', ')}; each waits for runner capacity`)
  const codes = await Promise.all(jobs.map(({ kind, steps }) => new Promise((done) => {
    const cores = planCores(kind, options, process.env, steps)
    const flags = [
      ...(cores !== undefined ? ['--cores', String(cores)] : []),
      '--wait', String(options.wait ?? 60),
      ...options.env.flatMap((pair) => ['--env', pair]),
      '--env', 'JUNO_RUNNER_PLAN=single', '--env', 'JUNO_PLAN_SERIAL=1',
    ]
    const child = spawn(process.execPath, [self, ...flags, 'test:plan', ...planWords(steps)], {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, JUNO_RUNNER_PLAN: 'single', JUNO_RUNNER_PARENT: '1' },
    })
    children.add(child)
    const results = new Map()
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', (line) => {
      const result = /^plan: step (\d+) (\S+) exited with (\d+)(.*)$/.exec(line)
      if (result && steps[Number(result[1])]?.script === result[2]) results.set(Number(result[1]), { code: Number(result[3]), suffix: result[4] })
      else log(`[runner:${kind}] ${line}`)
    })
    child.on('error', (error) => log(`[runner:${kind}] ${error.message}`))
    child.on('close', (code) => {
      children.delete(child)
      for (const [index, step] of steps.entries()) {
        const result = results.get(index)
        log(`plan: step ${step.index} ${step.script} exited with ${result?.code ?? (code || 255)}${result?.suffix ?? ' (job did not finish this step)'}`)
      }
      done(Math.max(code ?? 255, ...steps.map((_, index) => results.get(index)?.code ?? 255)))
    })
  })))
  return cancelled ? 130 : Math.max(...codes)
}
