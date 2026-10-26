// One SSH plan owns independent jobs through the shared tstack allocator.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parsePlan } from '../plan.mjs'
import { forwardSignals } from './children.mjs'

// Outside a full run, two four-core jobs: the browser and Electron lanes, which share builds, with the
// spec checks; and the unit tests, the DOM lane and the gallery.
const desktopJob = ['test:desktop', 'test:browser', 'test:electron', 'test:e2e', 'specs:check', 'specs:conformance']

// A full run (its gallery walks every state or a sample, GALLERY_SHIFT_ALL or GALLERY_SAMPLE) splits Juno's nine
// laptop cores by each step's measured CPU (docs/development.md, "Job sizes"). The unit job runs the unit tests,
// then the DOM lane. A sampled gallery walk reuses most states, so the gallery job gets two cores and the desktop
// job, the longest, four; even when a change re-keys most states, two cores walk them in about the desktop job's
// time on three. A walk of every state takes three cores. A step not named here joins the unit job. The desktop
// job runs Electron beside the browser lane (sideBySide in scripts/plan.mjs); the others run their steps in order.
const fullRunJob = (kind, cores, scripts, beside = false) => ({ kind, cores, beside, scripts })
const desktopSteps = ['test:desktop', 'test:browser', 'test:electron', 'test:e2e']
const gallerySteps = ['specs:check', 'specs:conformance', 'test:gallery']
export const fullRunJobs = {
  sampled: [fullRunJob('desktop', 4, desktopSteps, true), fullRunJob('unit', 3, ['test', 'test:dom']), fullRunJob('gallery', 2, gallerySteps)],
  everyState: [fullRunJob('desktop', 3, desktopSteps, true), fullRunJob('unit', 3, ['test', 'test:dom']), fullRunJob('gallery', 3, gallerySteps)],
}

/** The full run's jobs by its gallery step, or undefined for a plan that is not a full run. */
export function fullRunLayout(steps) {
  const gallery = steps.find((step) => step.script === 'test:gallery')
  return gallery?.env.GALLERY_SHIFT_ALL === '1' ? fullRunJobs.everyState : gallery?.env.GALLERY_SAMPLE !== undefined ? fullRunJobs.sampled : undefined
}

export function runnerPlanJobs(options, env = process.env) {
  const setting = (key) => options.env?.findLast((pair) => pair.startsWith(`${key}=`))?.slice(key.length + 1) ?? env[key]
  if (options.script !== 'test:plan' || setting('JUNO_RUNNER_PLAN') === 'single' || setting('JUNO_PLAN_SERIAL') === '1') return []
  const steps = parsePlan(options.args)
  const layout = fullRunLayout(steps)
  const groups = new Map()
  for (const [index, step] of steps.entries()) {
    const kind = layout ? layout.find((job) => job.scripts.includes(step.script))?.kind ?? 'unit'
      : desktopJob.includes(step.script) ? 'desktop' : 'unit'
    if (!groups.has(kind)) groups.set(kind, [])
    groups.get(kind).push({ ...step, index })
  }
  return groups.size > 1 ? [...groups].map(([kind, group]) => {
    const sized = layout?.find((job) => job.kind === kind)
    return { kind, steps: group, cores: sized?.cores, beside: sized?.beside }
  }) : []
}

export const planWords = (steps) => steps.flatMap((step, index) => [
  ...(index ? ['+'] : []), ...Object.entries(step.env).map(([key, value]) => `${key}=${value}`), step.script, ...step.args,
])

/** A unit job without the DOM lane or the gallery keeps the size its steps ask for (runnerJobSize). */
export const defaultPlanCores = (kind, steps) =>
  kind === 'desktop' || steps.some((step) => step.script === 'test:dom' || step.script === 'test:gallery') ? 4 : undefined

/** A job's cores: JUNO_RUNNER_<KIND>_CORES, then --cores, then a full run's measured size, then the default. */
export function planCores(kind, options, env = process.env, steps = [], sized = undefined) {
  const key = `JUNO_RUNNER_${kind.toUpperCase()}_CORES`
  const value = options.env.findLast((pair) => pair.startsWith(`${key}=`))?.slice(key.length + 1) ?? env[key]
  const cores = value === undefined ? options.cores ?? sized ?? defaultPlanCores(kind, steps) : Number(value)
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
  const codes = await Promise.all(jobs.map(({ kind, steps, cores: sized, beside }) => new Promise((done) => {
    const cores = planCores(kind, options, process.env, steps, sized)
    const flags = [
      ...(cores !== undefined ? ['--cores', String(cores)] : []),
      '--wait', String(options.wait ?? 60),
      '--priority', options.priority ?? 'normal',
      ...options.env.flatMap((pair) => ['--env', pair]),
      // A full run's other jobs and a repair keep their steps in order, as their sizes were measured.
      // Elsewhere a job's lanes run at once with their own workers: the gallery mostly waits for frames,
      // and the unit and DOM steps fill those cores at a lower priority.
      '--env', 'JUNO_RUNNER_PLAN=single',
      ...(beside ? [] : ['--env', verifyRun(options) ? 'JUNO_PLAN_SERIAL=1' : 'JUNO_PLAN_OVERLAP=1']),
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
