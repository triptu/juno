import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connect, createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { actionCases, recoveryCases, replayCases } from './agent-checks.mjs'
import { outboxPairs, outboxSchedules } from './outbox-checks.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const pkg = require.resolve('@informalsystems/quint/package.json')
const cli = join(dirname(pkg), 'dist/src/cli.js')
const tracesOnly = process.argv.includes('--traces')
const recoveryOnly = process.argv.includes('--recovery')
const actionsOnly = process.argv.includes('--actions')
const memoryOnly = process.argv.includes('--memory')
const boundedOnly = process.argv.includes('--bounded')
const outboxOnly = process.argv.includes('--outbox')
const backend = process.env.QUINT_SIMULATOR ?? 'rust'
const seed = '20261013'
const samples = tracesOnly ? 100 : 10000
const steps = 160
const startedAt = Date.now()
const apalacheVersion = '0.62.1' // Quint 0.33.0's default distribution.
const generated = join(root, 'specs/traces')
mkdirSync(generated, { recursive: true })

// Jobs are collected first. Typechecks and simulations run SPECS_JOBS at a time
// (default 3), then the Apalache checks run one at a time on one server.
// A passing job is cached under a hash of its arguments, what is checked on its
// output, its spec file and the Quint and Apalache versions, so an unchanged
// check is not run again. Bump cacheVersion when the checks on a result or the
// Apalache adapter below change. The cache is shared by every worktree. SPECS_CACHE=off or --no-cache runs everything.
const jobs = []
// SPECS_CACHE_DIR: pnpm remote brings the Mac's cache along and back.
const cacheDir = process.env.SPECS_CACHE_DIR ?? join(tmpdir(), 'juno-cache', 'specs')
const useCache = process.env.SPECS_CACHE !== 'off' && !process.argv.includes('--no-cache')
const parallel = Math.max(1, Number(process.env.SPECS_JOBS ?? 3))
const apalacheLanes = Math.max(1, Number(process.env.SPECS_APALACHE ?? 1))
const sha = (...parts) => {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(String(part)).update('\0')
  return hash.digest('hex')
}
const cacheVersion = 1
const runnerHash = sha(cacheVersion, require('@informalsystems/quint/package.json').version, apalacheVersion, backend, seed)
function specHash(file, seen = new Set()) {
  if (seen.has(file)) return ''
  seen.add(file)
  const text = readFileSync(join(root, file), 'utf8')
  const imports = [...text.matchAll(/from\s+"\.\/([\w-]+)(?:\.qnt)?"/g)].map(match => `specs/${match[1]}.qnt`)
  return sha(text, ...imports.map(name => specHash(name, seen)))
}

// Deadlines per Quint process, about four times the slowest run measured on a
// loaded machine (docs/development.md, "Faster test runs"). A timeout is a failure.
const deadlines = { verify: 180000, other: 60000 }

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

// One Apalache server for the whole run. Starting its JVM takes from a few
// seconds to over a minute on a loaded machine; Quint would start one per
// check. It starts on the first uncached Apalache check and has its own
// two-minute deadline; each check still has 60 seconds. Without a downloaded
// Apalache, each check lets Quint start (and download) its own on a free port.
const servers = []
function apalacheServer(lane) {
  servers[lane] ??= (async () => {
    const port = await freePort()
    const exe = join(process.env.QUINT_HOME ?? join(homedir(), '.quint'), `apalache-dist-${apalacheVersion}`, 'apalache/bin/apalache-mc')
    if (!existsSync(exe)) return { port, stop: () => {} }
    // Apalache's default 4 GB heap gets swapped out on a loaded 8 GB machine and
    // stalls a check past its deadline. The bounded checks fit in much less.
    const env = { ...process.env, JVM_ARGS: process.env.JVM_ARGS ?? `-Xmx${process.env.SPECS_APALACHE_HEAP ?? '1536m'}` }
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

function spawnQuint(args, timeout, port) {
  const verify = args[0] === 'verify'
  const commandArgs = verify ? [args[0], join(root, args[1]), ...args.slice(2), '--server-endpoint', `localhost:${port}`] : args
  const agentVerify = verify && args[1].startsWith('specs/agent-')
  const option = name => args[args.indexOf(name) + 1]
  const command = agentVerify ? [fileURLToPath(import.meta.url), '--verify-agent', JSON.stringify({
    input: join(root, args[1]), main: option('--main'), init: 'init', step: option('--step'),
    invariant: option('--invariant'), maxSteps: Number(option('--max-steps')),
    apalacheVersion, verbosity: 1, backend: 'apalache', port,
  })] : [cli, ...commandArgs]
  return new Promise(resolve => {
    // Keep Apalache's generated directory inside the ignored trace directory.
    const child = spawn(process.execPath, command, { cwd: verify ? generated : root, detached: process.platform !== 'win32' })
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

async function runJob(job, lane = 0) {
  const { args, violation, timeout, trace, check, checks } = job
  const label = `quint ${args.join(' ')}`
  const key = sha(runnerHash, JSON.stringify(args), violation, checks, specHash(args[1]))
  const cached = join(cacheDir, `${key}.json`)
  if (useCache && existsSync(cached)) {
    const saved = JSON.parse(readFileSync(cached, 'utf8'))
    if (trace) writeFileSync(trace, saved.trace)
    check(saved.output)
    return `${label}\n(unchanged, passed before: cached)\n${saved.notes}`
  }
  const budget = 720000 - (Date.now() - startedAt)
  if (budget <= 0) throw new Error('Spec check exceeded its twelve-minute execution budget')
  if (trace) rmSync(trace, { force: true })
  const port = args[0] !== 'verify' ? undefined : existsSync(join(process.env.QUINT_HOME ?? join(homedir(), '.quint'), `apalache-dist-${apalacheVersion}`)) ? (await apalacheServer(lane)).port : await freePort()
  const result = await spawnQuint(args, Math.min(timeout, Math.max(0, 720000 - (Date.now() - startedAt))), port)
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
  if (useCache) {
    mkdirSync(cacheDir, { recursive: true })
    const temporary = `${cached}.${process.pid}`
    writeFileSync(temporary, JSON.stringify({ output, notes, trace: trace ? readFileSync(trace, 'utf8') : undefined }))
    renameSync(temporary, cached)
  }
  return `${log}${notes}`
}

// JUNO_SHARD=i/n (pnpm remote --shards n) keeps this machine's share of the
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
  shardJobs()
  // On the Mac (SPECS_APALACHE=1): simulations first, SPECS_JOBS at a time, then
  // the Apalache checks one at a time and alone, because a JVM warming up next
  // to simulations on a loaded machine can miss its deadline. A machine of its
  // own (pnpm remote) sets SPECS_OVERLAP=1, and SPECS_APALACHE servers, each
  // with its own lane, run alongside the simulations.
  const queues = [jobs.filter(job => job.args[0] === 'verify'), jobs.filter(job => job.args[0] !== 'verify')]
  let failed
  const lane = async (queue, index = 0) => {
    while (queue.length > 0 && !failed) {
      const job = queue.shift()
      const started = Date.now()
      try {
        console.log(`${await runJob(job, index)}\n(${((Date.now() - started) / 1000).toFixed(1)} s)`)
      } catch (error) {
        failed ??= error
      }
    }
  }
  const simulations = () => Promise.all(Array.from({ length: parallel }, () => lane(queues[1])))
  const checks = () => Promise.all(Array.from({ length: apalacheLanes }, (_, index) => lane(queues[0], index)))
  if (apalacheLanes > 1 || process.env.SPECS_OVERLAP === '1') await Promise.all([simulations(), checks()])
  else {
    await simulations()
    await checks()
  }
  // A lane whose checks were all cached never started a server, so the array can have holes.
  for (const server of servers) if (server !== undefined) (await server.catch(() => ({ stop: () => {} }))).stop()
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
    ...(options.main ? ['--main', options.main] : []), ...(options.init ? ['--init', options.init] : []),
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

// Quint's RPC serialization keeps analysis metadata from every imported module.
// For memory this exceeds Apalache's 20 MB string limit. Keep exactly the types,
// effects and lookup entries whose IDs occur in the compiled main module. The
// module and all of its expressions remain unchanged. Run in a timed child just
// like the CLI; this adapter uses the pinned Quint 0.33.0 pipeline.
if (process.argv[2] === '--verify-agent') {
  const commands = require(join(dirname(pkg), 'dist/src/cliCommands.js'))
  const { parseServerEndpoint } = require(join(dirname(pkg), 'dist/src/apalache.js'))
  const args = JSON.parse(process.argv[3])
  args.serverEndpoint = parseServerEndpoint(`localhost:${args.port}`).value
  let result = await commands.load(args)
  for (const command of ['parse', 'typecheck', 'compile']) {
    if (result.isLeft()) break
    result = await commands[command](result.value)
  }
  if (!result.isLeft()) {
    const compiled = result.value
    const ids = new Set()
    function collect(value) {
      if (!value || typeof value !== 'object') return
      if (typeof value.id === 'bigint') ids.add(value.id)
      for (const child of Object.values(value)) collect(child)
    }
    collect(compiled.mainModule)
    const keep = entries => new Map([...entries].filter(([id]) => ids.has(id)))
    const reduced = { ...compiled, types: keep(compiled.types), effects: keep(compiled.effects), table: keep(compiled.table) }
    console.log(`Agent checker metadata: ${reduced.types.size}/${compiled.types.size} live type entries`)
    result = await commands.verifySpec(reduced)
  }
  if (result.isLeft()) {
    console.error(result.value.msg)
    for (const error of result.value.stage?.errors ?? []) console.error(error.message ?? error)
  }
  process.exit(result.isLeft() ? 1 : 0)
}

const regressions = [
  ['requestqueue', 'pauseWhileQueued', 'respectsPause', 'requestqueue-queued-pause'],
  ['requestqueue', 'methodSpacing', 'methodSpaced', 'requestqueue-method-spacing'],
  ['discovery', 'rootsFirst', 'noRedundantLookup', 'discovery-roots-first'],
  ['discovery', 'partialOpen', 'openedHasFull', 'discovery-partial-open'],
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
  ['metadata', 'staleRename', 'eventWins', 'metadata-stale-rename'],
  ['metadata', 'staleMembership', 'eventWins', 'metadata-stale-membership'],
  ['metadata', 'staleArchive', 'eventWins', 'metadata-stale-archive'],
  ['metadata', 'ownDm', 'quietAgreement', 'metadata-own-dm'],
  ['metadata', 'partial', 'quietAgreement', 'metadata-partial'],
  ['metadata', 'missedRename', 'quietAgreement', 'metadata-missed-rename'],
]
// Specs whose corrected runs must reach their drained agreement.
const drained = new Set(['outbox', 'catchup', 'metadata'])

const selectedSpec = actionsOnly ? 'agent-actions.qnt' : recoveryOnly ? 'agent-recovery.qnt' : memoryOnly ? 'agent-memory.qnt' : outboxOnly ? 'outbox.qnt' : undefined
for (const file of readdirSync(join(root, 'specs')).filter(name => name.endsWith('.qnt') && (!selectedSpec || name === selectedSpec || (recoveryOnly && name === 'agent-recovery-replay.qnt'))).toSorted()) {
  quint(['typecheck', `specs/${file}`])
}

if (!memoryOnly && !actionsOnly && !recoveryOnly && !boundedOnly) {
  for (const file of (outboxOnly ? ['outbox'] : ['follow', 'readstate', 'outbox', 'catchup', 'requestqueue', 'discovery', 'metadata', 'quietwindow'])) {
    simulate(file, 'simulationStep', 'invariants', `${file}.itf.json`, false, true,
      drained.has(file) ? { witnesses: ['reachedAgreement'] } : {})
  }
  for (const [file, schedule, invariant, name, guardedInvariant = 'invariants'] of regressions.filter(([file]) => !outboxOnly || file === 'outbox')) {
    simulate(file, `${schedule}Step`, guardedInvariant, `${name}.itf.json`, false, false,
      drained.has(file) ? { samples: 1, witnesses: ['reachedAgreement'], requireCompletion: true } : {})
    simulate(file, `${schedule}BugStep`, invariant, `${name}-bug.itf.json`, true)
  }
  for (const schedule of outboxSchedules) {
    simulate('outbox', `${schedule}Step`, 'invariants', `outbox-${schedule}.itf.json`, false, false,
      { samples: 1, witnesses: ['reachedAgreement'], requireCompletion: true })
  }
  if (!outboxOnly) {
    simulate('quietwindow', 'raiseMidSessionStep', 'invariants', 'window-raise.itf.json', false, false,
      { samples: 1, witnesses: ['reachedAgreement'], requireCompletion: true })
    simulate('readstate', 'peekBugStep', 'peekNeverMarks', 'peek-bug.itf.json', true)
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

// WP2 uses real transactions for both random runs and directed failure pairs.
if (!outboxOnly && !boundedOnly && !actionsOnly && !recoveryOnly) {
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

if (!outboxOnly && !boundedOnly && !memoryOnly && !recoveryOnly) {
  simulate('agent-actions', 'step', 'undoSurvivesRedelivery', 'resolve-corrected.itf.json', false, false, { main: 'agent_resolve', samples: 1, steps: 4 })
  simulate('agent-actions', 'bugStep', 'undoSurvivesRedelivery', 'resolve-bug.itf.json', true, false, { main: 'agent_resolve', samples: 1, steps: 4 })
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

if (!outboxOnly && !boundedOnly && !memoryOnly && !actionsOnly) {
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

if (!tracesOnly && !outboxOnly) {
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
      for (const [file, step] of [['follow', 'step'], ['readstate', 'boundedStep']]) {
        quint(['verify', `specs/${file}-bounded.qnt`, '--main', `${file}_bounded`, '--step', step,
          '--invariant', 'boundedSafety', '--max-steps', '4',
          '--apalache-version', apalacheVersion, '--verbosity', '1'])
      }
      // Long recovery regressions run in the simulator. Keep symbolic races short:
      // each old rule must break `acceptedUnfollow` within 5 steps, and its fix must not.
      for (const schedule of ['stalePage', 'lateEvent', 'pendingPage', 'failedLookup']) {
        for (const [step, violation] of [[`${schedule}BugStep`, true], [`${schedule}Step`, false]]) {
          quint(['verify', 'specs/follow-bounded.qnt', '--main', 'follow_bounded',
            '--step', step, '--invariant', 'acceptedUnfollow', '--max-steps', '5',
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
  }
}
await runAll()
console.log(`Spec check runtime: ${((Date.now() - startedAt) / 1000).toFixed(1)} seconds (excludes machine-lock wait).`)
