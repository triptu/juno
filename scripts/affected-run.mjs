// Run affected steps and retain a result even when installation or SSH fails.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { forwardSignals } from './remote/children.mjs'
import { failureCause, testResults } from './test-results-reporter.mjs'
import { runtimeIdentity } from './verify-inputs.mjs'
import { statusFolder } from './release-gate.mjs'
import { suitePassed } from './verify-repair.mjs'
import { keepReports } from './verify-reports.mjs'

const spawnStep = ({ root, children }, command, env, onLine) => new Promise((done) => {
    const started = Date.now()
    const child = spawn(command[0], command[1], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
    children.add(child)
    let text = ''
    for (const stream of [child.stdout, child.stderr]) {
      let rest = ''
      stream.on('data', (chunk) => {
        text += chunk
        const lines = (rest + chunk).split('\n')
        rest = lines.pop()
        for (const line of lines) onLine(line)
      })
      stream.on('end', () => { if (rest) onLine(rest) })
    }
    child.on('error', (error) => { text += `${error.message}\n` })
    child.on('close', (code, signal) => {
      children.delete(child)
      done({ code: code ?? (signal ? 130 : 1), signal, seconds: (Date.now() - started) / 1000, text })
    })
  })

export async function runPlan(plan, { root, local: localAll }) {
  const children = new Set()
  forwardSignals(children)
  let cancelled
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cancelled = signal })
  const runId = `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`
  const started = Date.now()
  const folder = join(statusFolder(root), 'affected', runId)
  mkdirSync(folder, { recursive: true })
  const record = (step, result, remote = false) => {
    const log = join(folder, `${plan.indexOf(step)}-${step.script.replaceAll(':', '_')}.log`)
    writeFileSync(log, result.text)
    const tests = testResults(result.text)
    const reported = /^juno-runtime: (.+)$/m.exec(result.text)
    const identity = reported ? JSON.parse(reported[1]) : remote ? undefined : runtimeIdentity(root)
    const code = cancelled && result.code !== 0 ? 130 : suitePassed({ code: result.code, tests }) ? 0 : result.code || 1
    return { step, code, seconds: result.seconds, log, tests, identity,
      cause: failureCause({ code, signal: cancelled ?? result.signal, tests, log: result.text }) }
  }
  const run = async (step) => record(step, await spawnStep({ root, children }, ['bun', ['run', step.script, ...step.args]], step.env, (line) => process.stdout.write(`[${step.script}] ${line}\n`)))
  const runRemote = async (steps) => {
    const words = steps.flatMap((step, index) => [...(index ? ['+'] : []), ...Object.entries(step.env ?? {}).map(([key, value]) => `${key}=${value}`), step.script, ...step.args])
    const outcomes = new Map()
    const result = await spawnStep({ root, children }, [process.execPath, [join(root, 'scripts/remote.mjs'), 'test:plan', ...words]], {}, (line) => {
      const match = /^plan: step (\d+) \S+ exited with (\d+)(?: after (\d+) s)?/.exec(line)
      if (match) outcomes.set(Number(match[1]), { code: Number(match[2]), seconds: match[3] ? Number(match[3]) : undefined })
      process.stdout.write(`${line}\n`)
    })
    const lines = result.text.split('\n').map((line) => line.replace(/^\[runner:[^\]]+\] /, ''))
    const results = steps.map((step, index) => {
      const prefix = `[${step.script}] `
      const text = lines.filter((line) => line.startsWith(prefix) || !line.startsWith('[')).map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line).join('\n')
      const outcome = outcomes.get(index)
      return record(step, { ...result, code: outcome?.code ?? (result.code || 255), seconds: outcome?.seconds ?? result.seconds, text }, true)
    })
    // A coordinator failure cannot turn into a green affected result.
    if (result.code !== 0 && results.every((item) => item.code === 0)) results.push(record({ script: 'plan', args: [], items: [] }, result, true))
    return results
  }
  const localTypecheck = plan.find((step) => step.script === 'typecheck')
  const results = localTypecheck ? [await run(localTypecheck)] : []
  const remaining = plan.filter((step) => step !== localTypecheck)
  if (!cancelled && results.every(({ code }) => code === 0)) {
    if (localAll) {
      for (const step of remaining) { if (cancelled) break; results.push(await run(step)) }
    } else {
      const remote = remaining.filter((step) => !step.local)
      const local = (async () => {
        const done = []
        for (const step of remaining.filter((item) => item.local)) { if (cancelled) break; done.push(await run(step)) }
        return done
      })()
      const [localResults, remoteResults] = await Promise.all([local, remote.length ? runRemote(remote) : []])
      results.push(...localResults, ...remoteResults)
    }
  }
  for (const step of plan.filter((step) => !results.some((result) => result.step === step)))
    results.push(record(step, { code: cancelled ? 130 : 255, seconds: 0, text: 'Step did not run because a prerequisite failed or the run was cancelled' }))
  if (cancelled && results.every(({ code }) => code === 0)) results.push(record({ script: 'plan', args: [] }, { code: 130, seconds: 0, text: 'Coordinator cancelled after suites finished' }))
  writeFileSync(join(folder, 'record.json'), JSON.stringify({ runId, reports: keepReports(root, folder, started), finishedAt: new Date().toISOString(), passed: results.every(({ code }) => code === 0), suites: results.map(({ step, ...result }) => ({ ...result, suite: step.script, args: step.args, env: step.env, items: (step.items ?? []).map((item) => item.id) })) }, null, 2) + '\n')
  return results
}
