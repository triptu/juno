// Runs a pnpm affected plan (scripts/affected.mjs). The remote steps run as one
// plan on one Namespace machine (scripts/plan.mjs), beside the local steps;
// `local` runs every step one after another here. Each step's result comes
// back separately, so the caller records the steps that passed.

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { forwardSignals } from './remote/children.mjs'
import { outageExit } from './remote/pool-decisions.mjs'

/**
 * Returns `{ step, code }` for each step that ran. A failing local typecheck
 * stops the run before it pays for remote machines. Without `localOnOutage` a
 * remote run waits out an outage, since this Mac is the owner's computer.
 */
export async function runPlan(plan, { root, local: localAll, localOnOutage }) {
  const children = new Set()
  forwardSignals(children)
  const spawnStep = (command, env, onLine) =>
    new Promise((resolvePromise) => {
      const child = spawn(command[0], command[1], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
      children.add(child)
      child.on('close', () => children.delete(child))
      for (const stream of [child.stdout, child.stderr]) {
        let rest = ''
        stream.on('data', (chunk) => {
          const lines = (rest + chunk).split('\n')
          rest = lines.pop()
          for (const line of lines) onLine(line)
        })
      }
      child.on('close', (code) => resolvePromise(code ?? 1))
    })
  const run = async (step) => ({ step, code: await spawnStep(['pnpm', [step.script, ...step.args]], step.env, (line) => process.stdout.write(`[${step.script}] ${line}\n`)) })
  /** One remote machine for every remote step; each step's result comes from the plan's `plan: step` lines. */
  const runRemote = async (steps) => {
    const words = steps.flatMap((step, index) => [...(index ? ['+'] : []), ...Object.entries(step.env ?? {}).map(([key, value]) => `${key}=${value}`), step.script, ...step.args])
    const codes = new Map()
    const env = localOnOutage && !process.env.JUNO_REMOTE_OUTAGE_WAIT ? { JUNO_REMOTE_OUTAGE_WAIT: '10m' } : {}
    const code = await spawnStep(['node', [join(root, 'scripts/remote.mjs'), 'test:plan', ...words]], env, (line) => {
      const result = /^plan: step (\d+) \S+ exited with (\d+)/.exec(line)
      if (result) codes.set(Number(result[1]), Number(result[2]))
      process.stdout.write(`${line}\n`)
    })
    // A step with no result line did not finish: the run failed before or during it.
    return steps.map((step, index) => ({ step, code: codes.get(index) ?? (code || 1) }))
  }

  const localTypecheck = plan.find((step) => step.script === 'typecheck')
  const results = localTypecheck ? [await run(localTypecheck)] : []
  if (results.some(({ code }) => code !== 0)) return results
  const remaining = plan.filter((step) => step !== localTypecheck)
  if (localAll) {
    for (const step of remaining) results.push(await run(step))
    return results
  }
  const remote = remaining.filter((step) => !step.local)
  const local = (async () => {
    const done = []
    for (const step of remaining.filter((item) => item.local)) done.push(await run(step))
    return done
  })()
  const [localResults, remoteResults] = await Promise.all([local, remote.length ? runRemote(remote) : []])
  results.push(...localResults)
  if (remoteResults.some(({ code }) => code === outageExit) && localOnOutage) {
    console.log('affected: Namespace is unreachable; running the remote steps on this Mac')
    for (const { step } of remoteResults) results.push(await run(step))
  } else {
    if (remoteResults.some(({ code }) => code === outageExit)) console.log('affected: Namespace is unreachable; pnpm affected --local runs these steps on this Mac')
    results.push(...remoteResults)
  }
  return results
}
