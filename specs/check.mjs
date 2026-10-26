import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connect, createServer } from 'node:net'
import { homedir, setPriority, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { actionCases, recoveryCases, replayCases } from './agent-checks.mjs'
import { outboxPairs, outboxSchedules } from './outbox-checks.mjs'
import { runtimeIdentity } from '../scripts/verify-inputs.mjs'
import { simulationBatch } from './simulate-batch.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const pkg = require.resolve('@informalsystems/quint/package.json')
const cli = join(dirname(pkg), 'dist/src/cli.js')
const tracesOnly = process.argv.includes('--traces')
const recoveryOnly = process.argv.includes('--recovery')
const actionsOnly = process.argv.includes('--actions')
const memoryOnly = process.argv.includes('--memory')
const boundedOnly = process.argv.includes('--bounded')
const huddleOnly = process.argv.includes('--huddle')
const outboxOnly = process.argv.includes('--outbox')
// --nightly (verify:main --nightly) reruns every check, ignoring the cache.
const nightly = process.argv.includes('--nightly')
const backend = process.env.QUINT_SIMULATOR ?? 'rust'
// Every simulation that runs takes a fresh seed, so breadth adds up over runs; `--seed <n>` or
// SPECS_SEED=<n> repeats one. The seed is not in the cache key: unchanged checks stay cached.
const seedFlag = process.argv.indexOf('--seed')
const seed = (seedFlag >= 0 ? process.argv[seedFlag + 1] : undefined) ?? process.env.SPECS_SEED ?? String(randomInt(1, 2 ** 32))
if (!/^\d+$/.test(seed)) throw new Error('--seed and SPECS_SEED take an unsigned integer')
console.log(`Spec check seed ${seed}; \`bun run specs:check --seed ${seed}\` repeats it.`)
// 500 traces per sync protocol, nightly too: a new seed each run samples new traces.
const samples = tracesOnly ? 100 : 500
const steps = 160
const startedAt = Date.now()
const apalacheVersion = '0.62.1' // Quint 0.33.0's default distribution.
const generated = join(root, 'specs/traces')
mkdirSync(generated, { recursive: true })

// Jobs retain individual cache entries. Single-sample schedules share one
// parsed/typechecked Quint process per file; each still gets a fresh evaluator.
// A passing simulation is cached under a hash of its arguments, what is checked on
// its output, its spec file and imports, this runner and the runtime, so an unchanged
// check is not run again. Bump cacheVersion when the checks on a result change.
// A passing solver (Apalache) check is cached under its arguments, its spec file and
// imports, the Quint and Apalache versions and the agent adapter only, so editing
// this runner does not rerun it; bump solverVersion when its handling here changes.
// The cache is shared by every worktree. SPECS_RUN_CACHE=off reruns simulations while
// retaining deterministic results; --nightly, SPECS_CACHE=off or --no-cache runs
// everything. The seed is left out of every key.
const jobs = []
// SPECS_CACHE_DIR: bun run remote brings the Mac's cache along and back.
const cacheDir = process.env.SPECS_CACHE_DIR ?? join(tmpdir(), 'juno-cache', 'specs')
const useCache = process.env.SPECS_CACHE !== 'off' && !process.argv.includes('--no-cache')
const cacheRuns = process.env.SPECS_RUN_CACHE !== 'off'
const parallel = Math.max(1, Number(process.env.SPECS_JOBS ?? 3))
const runnerThreads = Number(process.env.RUNNER_THREADS ?? process.env.JUNO_RUNNER_JOB_CORES ?? 0)
const memoryLimit = '/sys/fs/cgroup/memory.max'
const memoryBytes = existsSync(memoryLimit) ? Number(readFileSync(memoryLimit, 'utf8')) : Infinity
const memoryMiB = Number.isFinite(memoryBytes) ? memoryBytes / 1024 ** 2 : Infinity
// Leave 2 GiB for simulations, the checkout and tmpfs, plus 512 MiB of native
// JVM memory per lane. The default heap is 1.5 GiB. Local runs keep one server.
const memoryLanes = Number.isFinite(memoryMiB) ? Math.max(1, Math.floor((memoryMiB - 2048) / 2048)) : 1
const apalacheLanes = runnerThreads > 0
  ? Math.max(1, Math.min(Number(process.env.SPECS_APALACHE ?? Math.floor(runnerThreads / 2)), memoryLanes)) : 1
const apalacheHeap = process.env.SPECS_APALACHE_HEAP ?? `${Math.max(512, Math.min(1536, Math.floor((memoryMiB - 2048) / apalacheLanes) - 512))}m`
const measurements = []
let processes = 0
const sha = (...parts) => {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(String(part)).update('\0')
  return hash.digest('hex')
}
const cacheVersion = 2
const quintVersion = require('@informalsystems/quint/package.json').version
const solverVersion = 1
const solverHash = sha(solverVersion, quintVersion, apalacheVersion, readFileSync(join(root, 'specs/verify-agent.mjs')))
const runnerHash = sha(cacheVersion, quintVersion, apalacheVersion, backend, JSON.stringify(runtimeIdentity(root)), ...['check.mjs', 'simulate-batch.mjs', 'agent-checks.mjs', 'outbox-checks.mjs'].map((file) => readFileSync(join(root, 'specs', file))))
function specHash(file, seen = new Set()) {
  if (seen.has(file)) return ''
  seen.add(file)
  const text = readFileSync(join(root, file), 'utf8')
  const imports = [...text.matchAll(/from\s+"\.\/([\w-]+)(?:\.qnt)?"/g)].map(match => `specs/${match[1]}.qnt`)
  return sha(text, ...imports.map(name => specHash(name, seen)))
}

// Deadlines per Quint process, about four times the slowest run measured on a
// loaded machine (docs/development.md, "Faster test runs"). A timeout is a failure.
const deadlines = { verify: 360000, other: 60000 }

function quint(args, { violation = false, timeout = args[0] === 'verify' ? deadlines.verify : deadlines.other, trace, check = () => {}, checks = '' } = {}) {
  jobs.push({ args, violation, timeout, trace, check, checks })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

// One Apalache server per lane. Starting its JVM takes from a few
// seconds to over a minute on a loaded machine; Quint would start one per
// check. It starts on the first uncached Apalache check and has its own
// two-minute deadline; each check has 360 seconds. Without a downloaded
// Apalache, each check lets Quint start (and download) its own on a free port.
const servers = []
function apalacheServer(lane) {
  servers[lane] ??= (async () => {
    const port = await freePort()
    const exe = join(process.env.QUINT_HOME ?? join(homedir(), '.quint'), `apalache-dist-${apalacheVersion}`, 'apalache/bin/apalache-mc')
    if (!existsSync(exe)) return { port, stop: () => {} }
    // Apalache's default 4 GB heap gets swapped out on a loaded 8 GB machine and
    // stalls a check past its deadline. The bounded checks fit in much less.
    // Z3 does the solving on one thread. The JVM's default G1 collector and its
    // sizing for every CPU spent about a third more CPU on the same checks.
    const env = {
      ...process.env,
      JVM_ARGS: process.env.JVM_ARGS ?? `-Xmx${apalacheHeap} -XX:ActiveProcessorCount=1`,
      JVM_GC_ARGS: process.env.JVM_GC_ARGS ?? '-XX:+UseSerialGC',
    }
    const child = spawn(exe, ['server', `--port=${port}`], { cwd: generated, env, stdio: 'ignore', detached: process.platform !== 'win32' })
    const stop = () => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL') } catch { /* Already exited. */ } }
    process.on('exit', stop)
    const ready = () => new Promise(resolve => {
      const socket = connect(port, '127.0.0.1', () => { socket.destroy(); resolve(true) })
      socket.on('error', () => resolve(false))
    })
    const deadline = Date.now() + 120000
    while (!(await ready())) {
      if (child.exitCode !== null || Date.now() > deadline) {
        stop()
        throw new Error(`The Apalache server did not start on port ${port}`)
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    return { port, stop }
  })()
  return servers[lane]
}

// When simulations overlap the Apalache lanes, they run at a lower CPU priority, so a long bounded
// check does not end up last: a simulation on the sibling thread of the same core still slows it.
let simulationNiceness = 0

function spawnQuint(args, timeout, port) {
  processes++
  const verify = args[0] === 'verify'
  const commandArgs = verify ? [args[0], join(root, args[1]), ...args.slice(2), '--server-endpoint', `localhost:${port}`] : args
  const agentVerify = verify && args[1].startsWith('specs/agent-')
  const option = name => args[args.indexOf(name) + 1]
  const command = agentVerify ? [join(root, 'specs/verify-agent.mjs'), JSON.stringify({
    input: join(root, args[1]), main: option('--main'), init: 'init', step: option('--step'),
    invariant: option('--invariant'), maxSteps: Number(option('--max-steps')),
    apalacheVersion, verbosity: 1, backend: 'apalache', port,
  })] : [cli, ...commandArgs]
  return new Promise(resolve => {
    // Keep Apalache's generated directory inside the ignored trace directory.
    const child = spawn(process.execPath, command, { cwd: verify ? generated : root, detached: process.platform !== 'win32' })
    if (!verify && simulationNiceness > 0) setPriority(child.pid, simulationNiceness)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      // Do not leave a timed-out checker or its Java child holding machine resources.
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL') } catch { /* Already exited. */ }
    }, timeout)
    child.on('error', error => { clearTimeout(timer); resolve({ status: null, stdout, stderr, error }) })
    child.on('close', status => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr, error: timedOut ? new Error(`Quint timed out after ${timeout} ms`) : undefined })
    })
  })
}

async function runJob(job, lane = 0, execute = spawnQuint) {
  const started = Date.now()
  const { args, violation, timeout, trace, check, checks } = job
  const solver = args[0] === 'verify'
  const cacheJob = useCache && (args[0] !== 'run' || cacheRuns)
  const label = `quint ${args.join(' ')}`
  const keyed = JSON.stringify(args.filter((arg, index) => arg !== '--seed' && args[index - 1] !== '--seed'))
  const key = solver ? sha(solverHash, keyed, violation, specHash(args[1]))
    : sha(runnerHash, keyed, violation, checks, specHash(args[1]))
  const cached = join(cacheDir, `${key}.json`)
  // A nightly checks everything again and records the passes for the runs after it.
  if (cacheJob && !nightly && existsSync(cached)) {
    const saved = JSON.parse(readFileSync(cached, 'utf8'))
    if (trace) writeFileSync(trace, saved.trace)
    check(saved.output)
    measurements.push({ args, outcome: violation ? 'violation' : 'ok', cached: true, seconds: 0 })
    return `${label}\n(unchanged, passed before: cached)\n${saved.notes}`
  }
  const budget = 720000 - (Date.now() - startedAt)
  if (budget <= 0) throw new Error('Spec check exceeded its twelve-minute execution budget')
  if (trace) rmSync(trace, { force: true })
  const port = args[0] !== 'verify' ? undefined : existsSync(join(process.env.QUINT_HOME ?? join(homedir(), '.quint'), `apalache-dist-${apalacheVersion}`)) ? (await apalacheServer(lane)).port : await freePort()
  const result = await execute(args, Math.min(timeout, Math.max(0, 720000 - (Date.now() - startedAt))), port)
  const output = result.stdout + result.stderr
  const log = `${label}\n${output}`
  // A syntax, runtime, download, or tool failure is never an expected counterexample.
  if (result.error || (violation ? result.status !== 1 || !/Invariant violated|found a counterexample/.test(output) : result.status !== 0)) {
    throw Object.assign(new Error(result.error?.message ?? `Quint failed with status ${result.status}`), { log })
  }
  let notes
  try {
    notes = check(output) ?? ''
  } catch (error) {
    throw Object.assign(error, { log })
  }
  if (cacheJob) {
    mkdirSync(cacheDir, { recursive: true })
    const temporary = `${cached}.${process.pid}`
    writeFileSync(temporary, JSON.stringify({ output, notes, trace: trace ? readFileSync(trace, 'utf8') : undefined }))
    renameSync(temporary, cached)
  }
  measurements.push({ args, outcome: violation ? 'violation' : 'ok', cached: false, seconds: (Date.now() - started) / 1000 })
  return `${log}${notes}`
}

// JUNO_SHARD=i/n (bun run remote --shards n) keeps this machine's share of the
// jobs: typechecks on every shard, the rest dealt by expected cost to the
// lightest shard, so every job runs on exactly one shard.
function shardJobs() {
  const match = /^(\d+)\/(\d+)$/.exec(process.env.JUNO_SHARD ?? '')
  if (!match) return
  const [index, total] = [Number(match[1]), Number(match[2])]
  const loads = Array.from({ length: total }, () => 0)
  const cost = job => (job.args[0] === 'verify' ? 30 : Number(job.args[job.args.indexOf('--max-samples') + 1] ?? 1) >= 500 ? 20 : 1)
  const kept = jobs.filter(job => {
    if (job.args[0] === 'typecheck') return true
    const lightest = loads.indexOf(Math.min(...loads))
    loads[lightest] += cost(job)
    return lightest === index
  })
  console.log(`Shard ${index + 1} of ${total}: ${kept.length} of ${jobs.length} jobs.`)
  jobs.splice(0, jobs.length, ...kept)
}

async function runAll() {
  // A run or verify job parses and typechecks its whole file before it starts, and fails on a type error,
  // so a separate typecheck is kept only for files no other job reads.
  const read = new Set(jobs.filter(job => job.args[0] !== 'typecheck').map(job => job.args[1]))
  jobs.splice(0, jobs.length, ...jobs.filter(job => job.args[0] !== 'typecheck' || !read.has(job.args[1])))
  shardJobs()
  // Local execution serializes the JVM lane after simulations. Remote jobs
  // overlap independent JVM lanes with simulation groups within their quota.
  const groups = new Map()
  for (const job of jobs.filter(job => job.args[0] !== 'verify')) {
    const fixed = job.args[0] === 'run' && job.args[job.args.indexOf('--max-samples') + 1] === '1'
    const key = fixed ? job.args[1] : job
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(job)
  }
  // Deeper solver checks take longer, so they start first and the shallow ones fill in.
  const depth = job => Number(job.args[job.args.indexOf('--max-steps') + 1])
  const queues = [jobs.filter(job => job.args[0] === 'verify').toSorted((a, b) => depth(b) - depth(a)).map(job => [job]), [...groups.values()].toSorted((a, b) => b.length - a.length)]
  console.log(`Quint: ${jobs.length} jobs; ${parallel} simulation lanes; ${apalacheLanes} Apalache lanes, heap ${apalacheHeap} each.`)
  let failed
  const lane = async (queue, index = 0) => {
    while (queue.length > 0 && !failed) {
      const group = queue.shift()
      const batch = group.length > 1 ? simulationBatch(root, { niceness: simulationNiceness }) : undefined
      let launched = false
      const execute = batch ? (args, timeout) => {
        if (!launched) { processes++; launched = true }
        return batch.run(args, timeout)
      } : spawnQuint
      try {
        for (const job of group) {
          if (failed) break
          const started = Date.now()
          console.log(`${await runJob(job, index, execute)}\n(${((Date.now() - started) / 1000).toFixed(1)} s)`)
        }
      } catch (error) {
        failed ??= error
      } finally {
        batch?.stop()
      }
    }
  }
  const simulations = () => Promise.all(Array.from({ length: parallel }, () => lane(queues[1])))
  const checks = () => Promise.all(Array.from({ length: apalacheLanes }, (_, index) => lane(queues[0], index)))
  if (apalacheLanes > 1 || process.env.SPECS_OVERLAP === '1') {
    simulationNiceness = queues[0].length > 0 ? 10 : 0
    await Promise.all([simulations(), checks()])
  }
  else {
    await simulations()
    await checks()
  }
  // A lane whose checks were all cached never started a server, so the array can have holes.
  for (const server of servers) if (server !== undefined) (await server.catch(() => ({ stop: () => {} }))).stop()
  writeFileSync(join(generated, 'check-results.json'), JSON.stringify({ seconds: (Date.now() - startedAt) / 1000, processes, jobs: measurements }, null, 2))
  console.log(`Quint jobs: ${measurements.length}/${jobs.length} passed, ${measurements.filter(job => job.cached).length} cached; ${processes} processes; ${measurements.reduce((sum, job) => sum + job.seconds, 0).toFixed(1)} summed job seconds.`)
  if (failed) {
    if (failed.log) console.log(failed.log)
    throw failed
  }
}

function simulate(file, step, invariant, output, violation = false, randomized = false, options = {}) {
  const path = join(generated, output)
  quint(['run', `specs/${file}.qnt`, '--step', step, '--invariant', invariant,
    '--backend', backend, '--n-threads', '2', '--seed', seed, '--max-samples', String(options.samples ?? (randomized ? samples : 1)),
    '--max-steps', String(options.steps ?? (randomized ? steps : 80)), '--verbosity', '1',
    ...(options.main ? ['--main', options.main] : file === 'mutation-repair' ? ['--main', 'mutationRepair'] : []), ...(options.init ? ['--init', options.init] : []),
    '--out-itf', path, '--mbt', ...(options.witnesses ? ['--witnesses', ...options.witnesses] : randomized ? ['--witnesses', 'reachedAgreement'] : [])], {
    violation,
    trace: path,
    checks: JSON.stringify({ file, step, violation, randomized, options }),
    check: report => {
      for (const witness of options.witnesses ?? []) {
        if (!new RegExp(`${witness} was witnessed in [1-9][0-9]* trace`).test(report)) {
          throw new Error(`Missing completed agent schedule: ${witness}`)
        }
      }
      if (options.requireCompletion && !report.includes(`reachedAgreement was witnessed in ${options.samples} trace(s) out of ${options.samples}`)) {
        throw new Error('A corrected schedule stopped before completing its drain')
      }
      const trace = JSON.parse(readFileSync(path, 'utf8'))
      if (!Array.isArray(trace.states) || trace.states.length < 2) throw new Error(`No usable trace in ${path}`)
      if (file.startsWith('agent-') && !violation && !randomized) {
        const last = trace.states.at(-1)
        const state = Object.entries(last).find(([key]) => key === 's' || key.endsWith('::s'))?.[1]
        if (state?.label !== 'finished') throw new Error(`Agent schedule did not finish its drain: ${step}`)
      }
      return `${violation ? 'Expected counterexample' : 'Example trace'}: specs/traces/${output}`
    },
  })
}

const regressions = [
  ['reactors', 'raced', 'preservesConcurrentWrite', 'reactors-raced'],
  ['reactors', 'sameCount', 'pageDropsUnprovenNames', 'reactors-same-count'],
  ['requestqueue', 'pauseWhileQueued', 'respectsPause', 'requestqueue-queued-pause'],
  ['requestqueue', 'methodSpacing', 'methodSpaced', 'requestqueue-method-spacing'],
  ['discovery', 'rootsFirst', 'noRedundantLookup', 'discovery-roots-first'],
  ['discovery', 'partialOpen', 'openedHasFull', 'discovery-partial-open'],
  ['discovery', 'lateIndexed', 'lateIndexedKept', 'discovery-late-indexed'],
  ['follow', 'stalePage', 'acceptedUnfollow', 'stale-follow-page'],
  ['follow', 'lateEvent', 'acceptedUnfollow', 'accepted-unsubscribe-late-event'],
  ['follow', 'pendingPage', 'acceptedUnfollow', 'accepted-unsubscribe-pending-page'],
  ['follow', 'failedLookup', 'acceptedUnfollow', 'accepted-unsubscribe-failed-lookup'],
  ['follow', 'missedUnfollow', 'quietAgreement', 'missed-unfollow'],
  ['follow', 'missedFollow', 'quietAgreement', 'single-page'],
  ['follow', 'reorderedEvents', 'latestEventWins', 'reordered-follow-events', 'eventOrderSafety'],
  ['follow', 'fallbackObservation', 'fallbackKeepsLatestEvent', 'fallback-observation'],
  ['readstate', 'lateMark', 'acceptedUnreadProtected', 'late-read-event'],
  ['readstate', 'latePage', 'acceptedUnreadProtected', 'late-read-page'],
  ['readstate', 'pendingPage', 'acceptedUnreadProtected', 'pending-read-page'],
  ['readstate', 'pendingMark', 'quietAgreement', 'pending-read-event'],
  ...outboxPairs.map((pair) => ['outbox', ...pair]),
  ['catchup', 'newerThanPage', 'noFalseDelete', 'catchup-newer-than-page'],
  ['catchup', 'dropChanges', 'quietAgreement', 'catchup-drop-changes'],
  ['catchup', 'olderPage', 'quietAgreement', 'catchup-older-page'],
  ['mutation-repair', 'halfOpen', 'quietAgreement', 'mutation-half-open'],
  ['mutation-repair', 'failedFrame', 'quietAgreement', 'mutation-failed-frame'],
  ['mutation-repair', 'longGap', 'quietAgreement', 'mutation-long-gap'],
  ['mutation-repair', 'missingThread', 'drainBound', 'mutation-missing-thread'],
  ['mutation-repair', 'backwardsMarker', 'quietAgreement', 'mutation-backwards-marker'],
  ['mutation-repair', 'fallbackVersion', 'quietAgreement', 'mutation-fallback-version'],
  ['mutation-repair', 'unchanged', 'noFalseDelete', 'mutation-unchanged'],
  ['mutation-repair', 'failedRepair', 'quietAgreement', 'mutation-failed-repair'],
  ['metadata', 'staleRename', 'eventWins', 'metadata-stale-rename'],
  ['metadata', 'staleMembership', 'eventWins', 'metadata-stale-membership'],
  ['metadata', 'staleArchive', 'eventWins', 'metadata-stale-archive'],
  ['metadata', 'ownDm', 'quietAgreement', 'metadata-own-dm'],
  ['metadata', 'partial', 'quietAgreement', 'metadata-partial'],
  ['metadata', 'missedRename', 'quietAgreement', 'metadata-missed-rename'],
  ['threadranges', 'liveCount', 'countSound', 'thread-live-count'],
  ['threadranges', 'jumpGap', 'shownContinuous', 'thread-jump-gap'],
  ['threadranges', 'restartGap', 'countSound', 'thread-restart-gap'],
]
// Specs whose corrected runs must reach their drained agreement.
const drained = new Set(['outbox', 'catchup', 'metadata', 'mutation-repair'])

const selectedSpec = huddleOnly ? 'huddle.qnt' : actionsOnly ? 'agent-actions.qnt' : recoveryOnly ? 'agent-recovery.qnt' : memoryOnly ? 'agent-memory.qnt' : outboxOnly ? 'outbox.qnt' : undefined
for (const file of readdirSync(join(root, 'specs')).filter(name => name.endsWith('.qnt') && (!selectedSpec || name === selectedSpec || (huddleOnly && name === 'huddle-room.qnt') || (recoveryOnly && name === 'agent-recovery-replay.qnt'))).toSorted()) {
  quint(['typecheck', `specs/${file}`])
}

if (!huddleOnly && !memoryOnly && !actionsOnly && !recoveryOnly && !boundedOnly) {
  for (const file of (outboxOnly ? ['outbox'] : ['follow', 'readstate', 'outbox', 'catchup', 'mutation-repair', 'requestqueue', 'discovery', 'metadata', 'quietwindow', 'reactors', 'threadranges'])) {
    // Thread coverage posts at most six replies: 4,000 traces of 60 transitions reach their interleavings within the job budget.
    simulate(file, 'simulationStep', 'invariants', `${file}.itf.json`, false, true,
      drained.has(file) ? { witnesses: ['reachedAgreement'] } : file === 'threadranges' ? { steps: 60, samples: 4000 } : {})
  }
  for (const [file, schedule, invariant, name, guardedInvariant = 'invariants'] of regressions.filter(([file]) => !outboxOnly || file === 'outbox')) {
    simulate(file, `${schedule}Step`, guardedInvariant, `${name}.itf.json`, false, false,
      drained.has(file) ? { samples: 1, witnesses: ['reachedAgreement'], requireCompletion: true } : {})
    simulate(file, `${schedule}BugStep`, invariant, `${name}-bug.itf.json`, true)
  }
  simulate('outbox', 'simulationStep', 'invariants', 'broadcast-random.itf.json', false, true, { main: 'broadcastOutbox', witnesses: [] })
  simulate('outbox', 'lostStep', 'invariants', 'broadcast-lost.itf.json', false, false, { main: 'broadcastOutbox', steps: 11 })
  simulate('outbox', 'lostBugStep', 'invariants', 'broadcast-lost-bug.itf.json', true, false, { main: 'broadcastOutbox', steps: 11 })
  for (const schedule of [...outboxSchedules, 'boundedAction', 'defectAction', 'expiredReaction']) {
    simulate('outbox', `${schedule}Step`, 'invariants', `outbox-${schedule}.itf.json`, false, false,
      { samples: 1, witnesses: ['reachedAgreement'], requireCompletion: true })
  }
  if (!outboxOnly) {
    simulate('quietwindow', 'raiseMidSessionStep', 'invariants', 'window-raise.itf.json', false, false,
      { samples: 1, witnesses: ['reachedAgreement'], requireCompletion: true })
    simulate('readstate', 'peekBugStep', 'peekNeverMarks', 'peek-bug.itf.json', true)
    simulate('threadranges', 'followedDropStep', 'invariants', 'thread-followed-drop.itf.json')
    for (const schedule of ['authoredRoot', 'ambiguousFailure', 'pendingObservation', 'failedFirstSubscribe', 'unknownRoot', 'oldFollowActivity', 'oldFollowQuiet', 'widerWindow']) {
      simulate('follow', `${schedule}Step`, 'invariants', `${schedule}.itf.json`)
    }
    simulate('readstate', 'mirrorCatchUpStep', 'invariants', 'read-mirror-catchup.itf.json', false, false,
      { samples: 1, witnesses: ['reachedAgreement'], requireCompletion: true })
    simulate('readstate', 'mirrorCatchUpBugStep', 'catchUpNeverBackwards', 'read-mirror-catchup-bug.itf.json', true)
    simulate('readstate', 'coalesceStep', 'coalescingSafety', 'read-coalesce.itf.json')
    for (const schedule of ['retryAfterAccept', 'peekThenMark']) {
      simulate('readstate', `${schedule}Step`, 'invariants', `read-${schedule}.itf.json`)
    }
  }
}

if (!outboxOnly && !memoryOnly && !actionsOnly && !recoveryOnly && !boundedOnly) {
  simulate('huddle', 'simulationStep', 'invariants', 'huddle.itf.json', false, true,
    { samples: tracesOnly ? 100 : 1000, steps: 96, witnesses: ['reachedAgreement'] })
  simulate('huddle-room', 'step', 'invariants', 'huddle-room.itf.json', false, false,
    { main: 'huddle_room', samples: 1000, steps: 48 })
  const pairs = [
    ['ghost', 'noGhost'], ['oneCall', 'oneCall'], ['cancel', 'leaveDuringJoin'],
    ['stale', 'noStaleLeave'], ['overflow', 'matchingState'], ['otherDevice', 'otherDevice'], ['refusedLeave', 'noGhost'],
    ['pageDuringJoin', 'drainBound'], ['earlyReport', 'drainBound'],
    ['lostStart', 'drainBound'], ['workspaceRestart', 'oneCall'], ['unlistedPage', 'drainBound'],
    ['cancelDuringPersist', 'drainBound'], ['laggingInfo', 'matchingState'],
  ]
  for (const [schedule, invariant] of pairs) {
    simulate('huddle', `${schedule}BugStep`, invariant, `huddle-${schedule}-bug.itf.json`, true)
  }
  for (const schedule of [...pairs.map(([name]) => name), 'quit', 'reconnect', 'connectionLost', 'refused', 'crashBeforeMedia', 'crashAfterLeave', 'pageGone', 'engineCrash', 'pageDuringJoin', 'earlyReport', 'lostStart', 'workspaceRestart', 'unlistedPage', 'cancelDuringPersist']) {
    simulate('huddle', `${schedule}Step`, 'invariants', `huddle-${schedule}.itf.json`, false, false,
      { samples: 1, steps: 48, witnesses: ['reachedAgreement'], requireCompletion: true })
  }
}

// WP2 uses real transactions for both random runs and directed failure pairs.
if (!huddleOnly && !outboxOnly && !boundedOnly && !actionsOnly && !recoveryOnly) {
  const memoryOptions = { main: 'agent_memory' }
  simulate('agent-memory', 'simulationStep', 'invariants', 'agent-memory.itf.json', false, true,
    { ...memoryOptions, samples: tracesOnly ? 100 : 1000, steps: 140 })
  const memoryRegressions = [
    ['redactionRace', 'nodeInputsCurrent'],
    ['contextRace', 'taintClosureExact'],
    ['unrecordedContext', 'redactionExcludesReads'],
    ['lateReport', 'redactionExcludesReads'],
    ['latePin', 'redactionExcludesReads'],
    ['lateRequest', 'redactionExcludesReads'],
    ['overflow', 'requestBounded'],
    ['overlap', 'requestCoverageDeclared'],
    ['fastCompactor', 'viewWithinCutoff'],
    ['editedRequest', 'mandatoryPinsIncluded'],
    ['casRace', 'viewCAS'],
    ['atomicPublish', 'viewReferencesValid'],
    ['restart', 'restartPreservesHead'],
    ['crashTail', 'pendingWorkRecoverable'],
    ['retryQuiet', 'drainBound'],
    ['rawRequest', 'guardStampRequired'],
    ['alteredRequest', 'guardStampRequired'],
    ['mixedSnapshot', 'requestSnapshotConsistent'],
    ['pinText', 'pinAuthorityExact'],
    ['pinBudget', 'pinBudget'],
    ['toolPair', 'requestProtocolValid'],
    ['dueOrder', 'mergeDueOrder', 'dueInit'],
    ['siblings', 'viewPartition', 'siblingInit'],
    ['compactionPins', 'pinsSurviveCompaction', 'pinnedInit'],
    ['queueCurrent', 'pendingWorkRecoverable'],
    ['localTaint', 'taintLocal'],
    ['doubleEdit', 'pinEditCurrent'],
    ['oversizeParent', 'nodeBounded'],
    ['parallelLeaves', 'freshPublicationKept'],
    ['parallelRedaction', 'nodeInputsCurrent'],
  ]
  simulate('agent-memory', 'suiteStep', 'invariants', 'memory-corrected.itf.json', false, true,
    { ...memoryOptions, init: 'suiteInit', samples: 512, steps: 80,
      witnesses: ['reachedAgreement', ...memoryRegressions.map((_, index) => `case${index}`)], requireCompletion: true })
  for (const [schedule, invariant, init] of memoryRegressions) {
    const options = { ...memoryOptions, ...(init ? { init } : {}) }
    simulate('agent-memory', `${schedule}BugStep`, invariant, `memory-${schedule}-bug.itf.json`, true, false, options)
  }
}

if (!huddleOnly && !outboxOnly && !boundedOnly && !memoryOnly && !recoveryOnly) {
  simulate('agent-actions', 'step', 'undoSurvivesRedelivery', 'resolve-corrected.itf.json', false, false, { main: 'agent_resolve', samples: 1, steps: 4 })
  simulate('agent-actions', 'bugStep', 'undoSurvivesRedelivery', 'resolve-bug.itf.json', true, false, { main: 'agent_resolve', samples: 1, steps: 4 })
  const gate = { main: 'agent_host_gate', samples: 200, steps: 12 }
  simulate('agent-actions', 'step', 'hostGateSafety', 'host-gate.itf.json', false, true, { ...gate, witnesses: ['reachedAgreement'] })
  simulate('agent-actions', 'payloadBugStep', 'writesClicked', 'host-gate-payload-bug.itf.json', true, false, gate)
  simulate('agent-actions', 'reuseBugStep', 'oneWritePerAction', 'host-gate-reuse-bug.itf.json', true, false, gate)
  const options = { main: 'agent_actions' }
  simulate('agent-actions', 'simulationStep', 'invariants', 'agent-actions.itf.json', false, true,
    { ...options, samples: tracesOnly ? 100 : 1000, steps: 100 })
  simulate('agent-actions', 'suiteStep', 'invariants', 'actions-corrected.itf.json', false, true,
    { ...options, init: 'suiteInit', samples: 1024, steps: 80,
      witnesses: ['reachedAgreement', ...actionCases.map((_, index) => `case${index}`)], requireCompletion: true })
  simulate('agent-actions', 'clickedGrantStep', 'invariants', 'actions-clicked-grant.itf.json', false, false, options)
  simulate('agent-actions', 'clickedScheduleWitnessStep', 'invariants', 'actions-clicked-schedule.itf.json', false, true,
    { ...options, samples: 1, witnesses: ['reachedAgreement', 'clickedScheduleCreated'], requireCompletion: true })
  simulate('agent-actions', 'menuScheduleWitnessStep', 'invariants', 'actions-menu-schedule.itf.json', false, true,
    { ...options, samples: 1, witnesses: ['reachedAgreement', 'menuScheduleCreated'], requireCompletion: true })
  simulate('agent-actions', 'resumedClickWitnessStep', 'invariants', 'actions-resumed-click.itf.json', false, true,
    { ...options, samples: 1, witnesses: ['reachedAgreement', 'resumedClickSent'], requireCompletion: true })
  for (const [step, witness] of [['reviewedRunWitnessStep', 'reviewedRunSent'], ['neverImpliedWitnessStep', 'reviewedRunSent'], ['irreversibleClickWitnessStep', 'clickedOnce'],
    ['hintedReadWitnessStep', 'reviewedRunSent'], ['freshResetWitnessStep', 'reviewedRunSent'], ['impliedReadWitnessStep', 'reviewedRunSent']]) {
    simulate('agent-actions', step, 'invariants', `actions-${step.replace('WitnessStep', '')}.itf.json`, false, true,
      { ...options, samples: 1, witnesses: ['reachedAgreement', witness], requireCompletion: true })
  }
  for (const [schedule, invariant] of actionCases) {
    simulate('agent-actions', `${schedule}BugStep`, invariant, `actions-${schedule}-bug.itf.json`, true, false, options)
  }
  // The rule before the over-report decision: a reported cost above its reservation passes a strict cap.
  simulate('agent-actions', 'overReportStep', 'strictCap', 'actions-overReport-strictCap.itf.json', true, false, options)
}

if (!huddleOnly && !outboxOnly && !boundedOnly && !memoryOnly && !actionsOnly) {
  simulate('agent-recovery-replay', 'suiteStep', 'safety', 'recovery-replay-corrected.itf.json', false, true,
    { init: 'suiteInit', samples: 64, steps: 40,
      witnesses: ['reachedAgreement', 'case0', 'case1', 'case2', 'case3'], requireCompletion: true })
  for (const [schedule, invariant] of replayCases) {
    simulate('agent-recovery-replay', `${schedule}BugStep`, invariant, `recovery-${schedule}-bug.itf.json`, true)
  }
  // The same counterexample continues to a second remote effect.
  simulate('agent-recovery-replay', 'trailingStateBugStep', 'noRepeatedEffect', 'recovery-trailingState-effect-bug.itf.json', true)
  const options = { main: 'agent_recovery' }
  simulate('agent-recovery', 'simulationStep', 'cooperativeSafety', 'agent-recovery.itf.json', false, true,
    { ...options, samples: tracesOnly ? 100 : 1000, steps: 140 })
  simulate('agent-recovery', 'suiteStep', 'cooperativeSafety', 'recovery-corrected.itf.json', false, true,
    { ...options, init: 'suiteInit', samples: 1024, steps: 100,
      witnesses: ['reachedAgreement', ...recoveryCases.map((_, index) => `case${index}`)], requireCompletion: true })
  for (const [schedule, invariant] of recoveryCases) {
    simulate('agent-recovery', `${schedule}BugStep`, invariant, `recovery-${schedule}-bug.itf.json`, true, false,
      { ...options, steps: 100 })
  }
  for (const [schedule, witness] of [['deletionAhead', 'deletionAheadRecovered'], ['moveCodeRestore', 'moveCodeRestored']]) {
    simulate('agent-recovery', `${schedule}Step`, 'cooperativeSafety', `recovery-${schedule}.itf.json`, false, true,
      { ...options, samples: 1, witnesses: ['reachedAgreement', witness], requireCompletion: true })
  }
  for (const schedule of ['journalAhead', 'unsupportedSchema', 'cooperativeTransfer', 'reviewedRestore']) {
    simulate('agent-recovery', `${schedule}Step`, 'cooperativeSafety', `recovery-${schedule}.itf.json`, false, false, options)
  }
}

if (!huddleOnly && !tracesOnly && !outboxOnly) {
  // Find a working Java: PATH first, then JAVA_HOME, then Homebrew's keg-only JDKs.
  // macOS ships a /usr/bin/java stub that fails when no JDK is installed.
  const javaCandidates = [
    'java',
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin/java'),
    '/opt/homebrew/opt/openjdk@21/bin/java',
    '/opt/homebrew/opt/openjdk/bin/java',
    '/usr/local/opt/openjdk@21/bin/java',
  ].filter(Boolean)
  const javaPath = javaCandidates.find((candidate) => spawnSync(candidate, ['-version'], { encoding: 'utf8', timeout: 2000 }).status === 0)
  if (javaPath && javaPath !== 'java') {
    process.env.PATH = `${dirname(javaPath)}:${process.env.PATH}`
    process.env.JAVA_HOME = dirname(dirname(javaPath))
  }
  // Quint downloads Apalache on the first `verify` when it is missing.
  if (!javaPath) {
    console.log('Mode: randomized simulator only (Java unavailable).')
    console.log(`Seed ${seed}; selected agent protocols: 1000 random samples and all corrected witnesses (unless --bounded).`)
    console.log('Temporal formulas are typechecked only. Drain bounds: follow 64, read 48, outbox 48, memory 64, actions 32, recovery 64.')
  } else {
    if (!memoryOnly && !actionsOnly && !recoveryOnly) {
      // Each bound is the shortest one that reaches every state its rules talk about
      // (specs/README.md, "Solver bounds").
      for (const [file, step, invariant, depth] of [['follow', 'step', 'boundedSafety', 3], ['follow', 'step', 'failedCallReverted', 4], ['readstate', 'boundedStep', 'boundedSafety', 4]]) {
        quint(['verify', `specs/${file}-bounded.qnt`, '--main', `${file}_bounded`, '--step', step,
          '--invariant', invariant, '--max-steps', String(depth),
          '--apalache-version', apalacheVersion, '--verbosity', '1'])
      }
      // Long recovery regressions run in the simulator. Keep symbolic races short:
      // each old rule must break `acceptedUnfollow` within its bound, the length of its
      // shortest counterexample, and its fix must not.
      for (const [schedule, depth] of [['stalePage', 5], ['lateEvent', 5], ['pendingPage', 5], ['failedLookup', 4]]) {
        for (const [step, violation] of [[`${schedule}BugStep`, true], [`${schedule}Step`, false]]) {
          quint(['verify', 'specs/follow-bounded.qnt', '--main', 'follow_bounded',
            '--step', step, '--invariant', 'acceptedUnfollow', '--max-steps', String(depth),
            '--apalache-version', apalacheVersion, '--verbosity', '1'], { violation })
        }
      }
    }
    if (!actionsOnly && !recoveryOnly) {
      const memoryBounded = 'specs/agent-memory.qnt'
      quint(['verify', memoryBounded, '--main', 'agent_memory_bounded',
        '--step', 'boundedStep', '--invariant', 'boundedSafety', '--max-steps', '4',
        '--apalache-version', apalacheVersion, '--verbosity', '1'])
      for (const [step, violation] of [['boundedRaceBugStep', true], ['boundedRaceStep', false]]) {
        quint(['verify', memoryBounded, '--main', 'agent_memory_bounded',
          '--step', step, '--invariant', 'nodeInputsCurrent', '--max-steps', '6',
          '--apalache-version', apalacheVersion, '--verbosity', '1'], { violation })
      }
    }
    if (!memoryOnly && !recoveryOnly) {
      quint(['verify', 'specs/agent-actions.qnt', '--main', 'agent_actions_bounded', '--step', 'boundedStep',
        '--invariant', 'boundedSafety', '--max-steps', '4', '--apalache-version', apalacheVersion, '--verbosity', '1'])
      for (const [step, violation] of [['boundedRaceBugStep', true], ['boundedRaceStep', false]]) {
        quint(['verify', 'specs/agent-actions.qnt', '--main', 'agent_actions_bounded', '--step', step,
          '--invariant', 'pauseBlocksAuthorization', '--max-steps', '4', '--apalache-version', apalacheVersion, '--verbosity', '1'], { violation })
      }
    }
    if (!memoryOnly && !actionsOnly) {
      quint(['verify', 'specs/agent-recovery.qnt', '--main', 'agent_recovery_bounded', '--step', 'boundedStep',
        '--invariant', 'boundedSafety', '--max-steps', '4', '--apalache-version', apalacheVersion, '--verbosity', '1'])
      for (const [step, violation] of [['boundedRaceBugStep', true], ['boundedRaceStep', false]]) {
        quint(['verify', 'specs/agent-recovery.qnt', '--main', 'agent_recovery_bounded', '--step', step,
          '--invariant', 'singleLocalOwner', '--max-steps', '2', '--apalache-version', apalacheVersion, '--verbosity', '1'], { violation })
      }
    }
    console.log(`Mode: ${boundedOnly ? 'bounded Apalache' : 'simulator and bounded Apalache'}${memoryOnly ? ' (memory only)' : actionsOnly ? ' (actions only)' : recoveryOnly ? ' (recovery only)' : ''}.`)
    console.log('Bounded safety and races use the documented depths. Temporal liveness is typechecked only.')
    console.log(nightly ? 'Nightly: every check reruns.' : 'Solver checks reuse their last pass while their spec and its imports are unchanged; --nightly reruns them.')
  }
}
await runAll()
console.log(`Spec check runtime: ${((Date.now() - startedAt) / 1000).toFixed(1)} seconds (excludes machine-lock wait).`)
