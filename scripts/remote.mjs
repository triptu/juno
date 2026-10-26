// Runs Juno's Linux-safe suites through tstack's shared SSH host allocator.
// bun run remote [--cores n] [--wait seconds] [--env KEY=value] <script> [args...]
// bun run remote --local <script> [args...] uses the Mac's heavy-job queue.
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runnerConfig, checkRunner, runnerJobSize, ensureRunnerImage, hostCommand, localHint, quote } from './remote/runner.mjs'
import { snapshot } from './remote/workspace.mjs'
import { runnerPlanJobs, runRunnerPlan } from './remote/plan.mjs'
import { runShards } from './remote/shards.mjs'
import { keepAwake, streamJob } from './remote/stream.mjs'
import { parsePlan } from './plan.mjs'
import { runPlan } from './affected-run.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const self = fileURLToPath(import.meta.url)
const started = Date.now()
const remoteScripts = ['bench:engine', 'bench:sync', 'lint', 'perf', 'perf:part1', 'perf:part2', 'test', 'specs:check', 'specs:traces', 'specs:conformance', 'test:agent', 'test:agent-contracts', 'test:agent-testing', 'test:gallery', 'test:desktop', 'test:browser', 'test:dom', 'test:electron', 'test:e2e', 'test:nightly', 'test:plan', 'test:runner', 'test:repo-tools', 'test:health']
const localOnly = { 'test:feel': 'timing', 'gallery:shots': 'the Mac look' }

function parse(argv) {
  const options = { env: [], wait: Number(process.env.JUNO_RUNNER_WAIT ?? 60) }
  let index = 0
  for (; index < argv.length && argv[index].startsWith('--'); index++) {
    const flag = argv[index]
    if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--local') options.local = true
    else if (flag === '--cores') options.cores = Number(argv[++index])
    else if (flag === '--wait') options.wait = Number(argv[++index])
    else if (flag === '--shards') options.shards = Number(argv[++index])
    else if (flag === '--env') options.env.push(argv[++index])
    else if (flag === '--machine') {
      const match = /^linux\/amd64:(\d+)x\d+$/.exec(argv[++index] ?? '')
      if (!match) throw new Error('--machine takes linux/amd64:NxM; prefer --cores for physical cores')
      options.cores = Math.ceil(Number(match[1]) / 2)
    } else throw new Error(`Unknown option ${flag}`)
  }
  if (options.cores === undefined && process.env.JUNO_REMOTE_MACHINE) {
    const match = /^linux\/amd64:(\d+)x\d+$/.exec(process.env.JUNO_REMOTE_MACHINE)
    if (!match) throw new Error('JUNO_REMOTE_MACHINE takes linux/amd64:NxM; prefer --cores')
    options.cores = Math.ceil(Number(match[1]) / 2)
  }
  if (options.cores !== undefined && (!Number.isSafeInteger(options.cores) || options.cores < 1)) throw new Error('--cores must be a positive integer')
  if (!Number.isSafeInteger(options.wait) || options.wait < 0) throw new Error('--wait must be a non-negative number of seconds')
  for (const pair of options.env) if (!/^[A-Za-z_][A-Za-z0-9_]*=[^\n\r]*$/.test(pair ?? '')) throw new Error('--env takes NAME=value on one line')
  if (process.env.JUNO_PLAN_SERIAL === '1' && !options.env.some((pair) => pair.startsWith('JUNO_PLAN_SERIAL='))) options.env.push('JUNO_PLAN_SERIAL=1')
  const [script, ...args] = argv.slice(index)
  if (!script) throw new Error('usage: bun run remote [--local] [--cores n] [--wait seconds] <script> [args...]')
  // A split plan can queue an app job behind the unit/spec jobs in the same allocation.
  if (runnerPlanJobs({ ...options, script, args }).length > 0 && !argv.includes('--wait') && process.env.JUNO_RUNNER_WAIT === undefined) options.wait = 3600
  const steps = script === 'test:plan' ? parsePlan(args) : [{ script, args }]
  for (const step of steps) {
    if (localOnly[step.script]) throw new Error(`${step.script} measures ${localOnly[step.script]} and runs only on the Mac. Run bun run ${step.script} locally.`)
    if (!remoteScripts.includes(step.script)) throw new Error(`${step.script} is not set up for remote runs`)
    if (step.script === 'test:e2e' && step.args.length) throw new Error('Select files with test:desktop or test:gallery')
  }
  return { ...options, script, args }
}

let options
try { options = parse(process.argv.slice(2)) } catch (error) { console.error(`remote: ${error.message}`); process.exit(2) }
if (process.env.JUNO_RUNNER_PARENT === '1') {
  // A killed coordinator closes this pipe, so its children stop sending heartbeats.
  process.stdin.resume()
  process.stdin.once('end', () => process.kill(process.pid, 'SIGTERM'))
}
let cancelled = false
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cancelled = true })
if (options.local) {
  const steps = options.script === 'test:plan' ? parsePlan(options.args) : [{ script: options.script, args: options.args }]
  const env = Object.fromEntries(options.env.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]))
  const plan = steps.map((step) => ({ ...step, env: { ...env, ...step.env } }))
  if (options.dryRun) console.log(plan.map((step) => `bun run ${step.script} ${step.args.join(' ')}`).join('\n'))
  else process.exit((await runPlan(plan, { root, local: true })).every(({ code }) => code === 0) ? 0 : 1)
  process.exit(0)
}
const allowSleep = keepAwake()
process.once('exit', allowSleep)
if (options.shards !== undefined) {
  const at = process.argv.indexOf('--shards')
  const rest = process.argv.slice(2).filter((_, i) => i !== at - 2 && i !== at - 1)
  process.exit(await runShards({ total: options.shards, rest, self, root, desktop: options.script === 'test:desktop' && !options.args.some((arg) => arg.startsWith('--repeat-each')), dryRun: options.dryRun }))
}
const runId = `juno-${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`
const reportDir = join(root, '.remote', runId)
let runLog, work, code = 255, reserved, threads
let jobStarted = false
const log = (line) => { if (line.startsWith('juno-runtime:')) jobStarted = true; console.log(line); if (runLog) appendFileSync(runLog, `${line}\n`); const match = /^remote: allocated threads=(\d+)$/.exec(line); if (match) threads = Number(match[1]) }
try {
  hostCommand('check') // Fail clearly before preparing any work if tstack is missing.
  const runner = runnerConfig()
  const jobs = runnerPlanJobs(options)
  if (options.dryRun) {
    log(`remote: tstack SSH runner; ${jobs.length ? jobs.map((job) => job.kind).join(', ') + ' jobs' : options.script}; wait ${options.wait} s; image ${runner.image}`)
    process.exit(0)
  }
  mkdirSync(reportDir, { recursive: true })
  runLog = join(reportDir, 'run.log')
  writeFileSync(runLog, `bun run ${[options.script, ...options.args].map(quote).join(' ')}\nremote: run ${JSON.stringify({ version: 1, script: options.script, args: options.args, started: new Date(started).toISOString() })}\n`)
  // A plan's coordinator has checked the runner and its image and packed the workspace once for its jobs.
  const inherited = process.env.JUNO_RUNNER_PARENT === '1' && process.env.JUNO_RUNNER_HEALTH ? JSON.parse(process.env.JUNO_RUNNER_HEALTH) : undefined
  const health = inherited ?? checkRunner(runner)
  if (!health.reachable) throw new Error(`runner unreachable: ${health.reason}. ${localHint}.`)
  runner.args = health.args ?? runner.args
  if (cancelled) throw new Error('run cancelled')
  // The image check is an SSH round trip; packing the workspace overlaps it.
  const image = inherited?.image === runner.image ? Promise.resolve() : ensureRunnerImage(runner, log)
  image.catch(() => {})
  work = mkdtempSync(join(existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork' : tmpdir(), 'juno-remote-'))
  const pack = () => {
    const { files, bytes } = snapshot(root)
    log(`remote: ${files.length} files (${(bytes / 1048576).toFixed(1)} MB before compression), no secrets found`)
    const list = join(work, 'files'), tarball = join(work, 'workspace.tgz')
    writeFileSync(list, files.join('\0'))
    const packed = spawnSync('tar', ['-czf', tarball, '--no-xattrs', '--null', '-T', list], { cwd: root, env: { ...process.env, COPYFILE_DISABLE: '1' }, encoding: 'utf8' })
    if (packed.status !== 0) throw new Error(`could not pack workspace: ${packed.stderr}`)
    return tarball
  }
  if (jobs.length) {
    renameSync(runLog, join(reportDir, 'plan.log')); runLog = join(reportDir, 'plan.log')
    const tarball = pack()
    await image
    if (cancelled) throw new Error('run cancelled')
    const env = { JUNO_RUNNER_HEALTH: JSON.stringify({ ...health, args: runner.args, image: runner.image }), JUNO_REMOTE_TARBALL: tarball }
    code = await runRunnerPlan(jobs, { self, root, options, log, env })
  } else {
    const shared = process.env.JUNO_RUNNER_PARENT === '1' ? process.env.JUNO_REMOTE_TARBALL : undefined
    const tarball = shared && existsSync(shared) ? shared : pack()
    // The spec cache lives on the runner (scripts/remote/run.sh) and nearly always holds the last pass.
    const specsCached = process.env.SPECS_RUN_CACHE !== 'off' && !options.env.includes('SPECS_RUN_CACHE=off')
    const size = runnerJobSize({ ...options, specsCached }, health.cores)
    reserved = size.reserved
    await image
    if (cancelled) throw new Error('run cancelled')
    const args = [`id=${runId}`, `cores=${reserved}`, `memory=${reserved * 3}g`, `image=${runner.image}`, 'project=juno', `wait=${options.wait}`, `command=bash scripts/remote/run.sh ${[options.script, ...options.args].map(quote).join(' ')}`, 'artifact=.remote/reports.tgz', ...options.env.map((pair) => `env=${pair}`), `env=JUNO_RUNNER_WIDE_UNIT=${size.wideUnit ? 1 : 0}`, `env=JUNO_RUNNER_PINNED=${health.pinned ? 1 : 0}`]
    log(`remote: SSH job ${runId}, ${reserved} ${health.pinned ? 'physical cores' : 'CPUs'}`)
    const result = await streamJob(runner, args, tarball, log)
    code = result.code
    if (code !== 0 && !cancelled && !jobStarted && options.env.includes('JUNO_VERIFY_POLICY=1'))
      log(`juno-stop: ${JSON.stringify({ scope: 'run', rule: 'setup', signature: `Remote job exited with ${code} before its plan started` })}`)
    if (result.artifacts) {
      const fetched = spawnSync('ssh', [...runner.args, hostCommand('fetch', [runId])], { maxBuffer: 1024 * 1024 * 1024, timeout: 60_000 })
      if (fetched.status !== 0) throw new Error('could not fetch remote reports')
      const unpack = (args, input) => { if (spawnSync('tar', args, { input }).status !== 0) throw new Error('could not unpack remote reports') }
      unpack(['-xzf', '-', '-C', work], fetched.stdout)
      unpack(['-xzf', join(work, '.remote/reports.tgz'), '-C', reportDir])
      log(`remote: reports in ${relative(root, reportDir)}/`)
    }
  }
} catch (error) {
  log(`remote: ${error.message}`)
  if (!cancelled && options.env.includes('JUNO_VERIFY_POLICY=1')) log(`juno-stop: ${JSON.stringify({ scope: 'run', rule: 'setup', signature: error.message })}`)
  code = cancelled ? 130 : 255
} finally {
  if (work) rmSync(work, { recursive: true, force: true })
  if (runLog) {
    appendFileSync(runLog, `remote: exited with ${code}\nremote: summary ${JSON.stringify({ code, backend: 'ssh', cores: reserved, threads, wallSeconds: (Date.now() - started) / 1000 })}\n`)
    console.log(`remote: output in ${relative(root, runLog)}`)
  }
}
process.exit(cancelled ? 130 : code)
