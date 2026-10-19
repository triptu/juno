// One SSH plan owns independent jobs. Namespace keeps one machine per plan.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { appSuites, parsePlan } from '../plan.mjs'
import { forwardSignals } from './children.mjs'

export function runnerPlanJobs(options, env = process.env) {
  const setting = (key) => options.env?.findLast((pair) => pair.startsWith(`${key}=`))?.slice(key.length + 1) ?? env[key]
  if (options.script !== 'test:plan' || setting('JUNO_RUNNER_PLAN') === 'single' || setting('JUNO_PLAN_SERIAL') === '1') return []
  const steps = parsePlan(options.args)
  const groups = new Map()
  for (const [index, step] of steps.entries()) {
    const kind = appSuites.includes(step.script) ? 'app' : step.script.startsWith('specs:') ? 'specs' : 'unit'
    if (!groups.has(kind)) groups.set(kind, [])
    groups.get(kind).push({ ...step, index })
  }
  return groups.size > 1 ? [...groups].map(([kind, group]) => ({ kind, steps: group })) : []
}

export const planWords = (steps) => steps.flatMap((step, index) => [
  ...(index ? ['+'] : []), ...Object.entries(step.env).map(([key, value]) => `${key}=${value}`), step.script, ...step.args,
])

export async function runRunnerPlan(jobs, { self, root, options, log }) {
  const children = new Set()
  forwardSignals(children)
  let cancelled = false
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cancelled = true })
  log(`remote: SSH plan in ${jobs.length} jobs: ${jobs.map((job) => job.kind).join(', ')}; each waits for runner capacity`)
  const codes = await Promise.all(jobs.map(({ kind, steps }) => new Promise((done) => {
    const flags = [
      ...(options.explicitMachine ? ['--machine', options.machine] : []),
      ...options.env.flatMap((pair) => ['--env', pair]),
      '--env', 'JUNO_RUNNER_PLAN=single', '--env', 'JUNO_PLAN_SERIAL=1',
    ]
    // Once jobs start, do not scatter the remainder onto paid machines.
    // Each container uses the existing host admission, cleanup and reports.
    const child = spawn(process.execPath, [self, ...flags, 'test:plan', ...planWords(steps)], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, JUNO_RUNNER_PLAN: 'single', JUNO_REMOTE_MAX_VCPU: '0' },
    })
    children.add(child)
    const results = new Map()
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', (line) => {
      const result = /^plan: step (\d+) (\S+) exited with (\d+)(.*)$/.exec(line)
      if (result) results.set(Number(result[1]), { code: Number(result[3]), suffix: result[4] })
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
