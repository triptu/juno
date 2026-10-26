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
// A nightly (docs/development.md, "Nightly runs"): each perf part starts a job alone, on the cores its baseline was
// measured on (one, then two), and that job then runs serial steps. The rest share a five-core job with its lanes at
// once: the gallery walk mostly waits for frames, and the spec check fills those threads at a lower priority.
const nightlyJobs = { 'perf:part1': 'perf1', 'test:dom': 'perf1', 'perf:part2': 'perf2', test: 'perf2', 'specs:conformance': 'perf2', 'test:electron': 'perf2' }
const nightlyCores = { perf1: 1, perf2: 2, wide: 5 }

export function runnerPlanJobs(options, env = process.env) {
  const setting = (key) => options.env?.findLast((pair) => pair.startsWith(`${key}=`))?.slice(key.length + 1) ?? env[key]
  if (options.script !== 'test:plan' || setting('JUNO_RUNNER_PLAN') === 'single' || setting('JUNO_PLAN_SERIAL') === '1') return []
  const steps = parsePlan(options.args)
  // An uncached gallery walk (a nightly, --no-cache) is about half of all the CPU: it gets a job of
  // its own, and the other job takes every other step.
  const fullWalk = steps.some((step) => step.script === 'test:gallery' && step.env.GALLERY_SHIFT_ALL === '1')
  const nightly = steps.some((step) => step.script.startsWith('perf:part'))
  const groups = new Map()
  for (const [index, step] of steps.entries()) {
    const kind = nightly ? nightlyJobs[step.script] ?? 'wide'
      : fullWalk ? step.script === 'test:gallery' ? 'gallery' : 'desktop' : desktopJob.includes(step.script) ? 'desktop' : 'unit'
    if (!groups.has(kind)) groups.set(kind, [])
    // Beside the spec check, the walk gets one walker per thread of its five cores (workers.sh).
    const env = kind === 'wide' && step.script === 'test:gallery' ? { GALLERY_WORKERS: '10', ...step.env } : step.env
    groups.get(kind).push({ ...step, env, index })
  }
  return groups.size > 1 ? [...groups].map(([kind, group]) => ({ kind, steps: group, ...(nightly ? { cores: nightlyCores[kind], overlap: kind === 'wide' } : {}) })) : []
}

export const planWords = (steps) => steps.flatMap((step, index) => [
  ...(index ? ['+'] : []), ...Object.entries(step.env).map(([key, value]) => `${key}=${value}`), step.script, ...step.args,
])

/** A unit job without the DOM lane or the gallery keeps the size its steps ask for (runnerJobSize). */
export const defaultPlanCores = (kind, steps) =>
  kind === 'desktop' || steps.some((step) => step.script === 'test:dom' || step.script === 'test:gallery') ? 4 : undefined

export function planCores(kind, options, env = process.env, steps = [], planned = undefined) {
  const key = `JUNO_RUNNER_${kind.toUpperCase()}_CORES`
  const value = options.env.findLast((pair) => pair.startsWith(`${key}=`))?.slice(key.length + 1) ?? env[key]
  const cores = value === undefined ? planned ?? options.cores ?? defaultPlanCores(kind, steps) : Number(value)
  if (cores !== undefined && (!Number.isInteger(cores) || cores < 1)) throw new Error(`${key} must be a positive whole number`)
  return cores
}

const verifyRun = (options) => options.env.includes('JUNO_VERIFY_POLICY=1') || process.env.JUNO_VERIFY_POLICY === '1'

export async function runRunnerPlan(jobs, { self, root, options, log, env = {} }) {
  const children = new Set()
  forwardSignals(children)
  let cancelled = false
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cancelled = true })
  log(`remote: SSH plan in ${jobs.length} jobs: ${jobs.map((job) => job.kind).join(', ')}; each waits for runner capacity`)
  const codes = await Promise.all(jobs.map(({ kind, steps, cores: planned, overlap }) => new Promise((done) => {
    const cores = planCores(kind, options, process.env, steps, planned)
    const flags = [
      ...(cores !== undefined ? ['--cores', String(cores)] : []),
      '--wait', String(options.wait ?? 60),
      ...options.env.flatMap((pair) => ['--env', pair]),
      // A full run keeps each job's steps in order, as its job sizes were measured, except a nightly's
      // wide job. Elsewhere a job's lanes run at once with their own workers: the gallery mostly
      // waits for frames, and the unit and DOM steps fill those cores at a lower priority.
      '--env', 'JUNO_RUNNER_PLAN=single', '--env', verifyRun(options) && !overlap ? 'JUNO_PLAN_SERIAL=1' : 'JUNO_PLAN_OVERLAP=1',
    ]
    const child = spawn(process.execPath, [self, ...flags, 'test:plan', ...planWords(steps)], {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env, JUNO_RUNNER_PLAN: 'single', JUNO_RUNNER_PARENT: '1' },
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
