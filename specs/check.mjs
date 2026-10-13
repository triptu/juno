import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const pkg = require.resolve('@informalsystems/quint/package.json')
const cli = join(dirname(pkg), 'dist/src/cli.js')
const tracesOnly = process.argv.includes('--traces')
const memoryOnly = process.argv.includes('--memory')
const boundedOnly = process.argv.includes('--bounded')
const backend = process.env.QUINT_SIMULATOR ?? 'rust'
const seed = '20261013'
const samples = tracesOnly ? 100 : 10000
const steps = 160
const startedAt = Date.now()
const apalacheVersion = '0.62.1' // Quint 0.33.0's default distribution.
const generated = join(root, 'specs/traces')
mkdirSync(generated, { recursive: true })

function quint(args, { violation = false, timeout = 60000 } = {}) {
  const budget = 540000 - (Date.now() - startedAt)
  if (budget <= 0) throw new Error('Spec check exceeded its nine-minute execution budget')
  console.log(`quint ${args.join(' ')}`)
  // Keep Apalache's generated directory inside the ignored trace directory.
  const verify = args[0] === 'verify'
  const commandArgs = verify ? [args[0], join(root, args[1]), ...args.slice(2)] : args
  const memoryVerify = verify && args[1] === 'specs/agent-memory.qnt'
  const option = name => args[args.indexOf(name) + 1]
  const command = memoryVerify ? [fileURLToPath(import.meta.url), '--verify-memory', JSON.stringify({
    input: join(root, args[1]), main: option('--main'), init: 'init', step: option('--step'),
    invariant: option('--invariant'), maxSteps: Number(option('--max-steps')),
    apalacheVersion, verbosity: 1, backend: 'apalache',
  })] : [cli, ...commandArgs]
  const result = spawnSync(process.execPath, command, {
    cwd: verify ? generated : root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: Math.min(timeout, budget), detached: process.platform !== 'win32',
  })
  if (result.error && result.pid && process.platform !== 'win32') {
    // Do not leave a timed-out checker or its Java child holding machine resources.
    try { process.kill(-result.pid, 'SIGKILL') } catch { /* Already exited. */ }
  }
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  // A syntax, runtime, download, or tool failure is never an expected counterexample.
  if (result.error || (violation ? result.status !== 1 || !/Invariant violated|found a counterexample/.test(result.stderr + result.stdout) : result.status !== 0)) {
    throw new Error(result.error?.message ?? `Quint failed with status ${result.status}`)
  }
  return result.stdout + result.stderr
}

function simulate(file, step, invariant, output, violation = false, randomized = false, options = {}) {
  const path = join(generated, output)
  rmSync(path, { force: true })
  const report = quint(['run', `specs/${file}.qnt`, '--step', step, '--invariant', invariant,
    '--backend', backend, '--n-threads', '2', '--seed', seed, '--max-samples', String(options.samples ?? (randomized ? samples : 1)),
    '--max-steps', String(options.steps ?? (randomized ? steps : 80)), '--verbosity', '1',
    ...(options.main ? ['--main', options.main] : []), ...(options.init ? ['--init', options.init] : []),
    '--out-itf', path, '--mbt', ...(options.witnesses ? ['--witnesses', ...options.witnesses] : randomized ? ['--witnesses', 'reachedAgreement'] : [])], { violation })
  for (const witness of options.witnesses ?? []) {
    if (!new RegExp(`${witness} was witnessed in [1-9][0-9]* trace`).test(report)) {
      throw new Error(`Missing completed memory schedule: ${witness}`)
    }
  }
  if (options.requireCompletion && !report.includes(`reachedAgreement was witnessed in ${options.samples} trace(s) out of ${options.samples}`)) {
    throw new Error('A corrected memory schedule stopped before completing its drain')
  }
  const trace = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(trace.states) || trace.states.length < 2) throw new Error(`No usable trace in ${path}`)
  if (file === 'agent-memory' && !violation && !randomized) {
    const last = trace.states.at(-1)
    const state = Object.entries(last).find(([key]) => key === 's' || key.endsWith('::s'))?.[1]
    if (state?.label !== 'finished') throw new Error(`Memory schedule did not finish its drain: ${step}`)
  }
  console.log(`${violation ? 'Expected counterexample' : 'Example trace'}: specs/traces/${output}`)
}

// Quint's RPC serialization keeps analysis metadata from every imported module.
// For memory this exceeds Apalache's 20 MB string limit. Keep exactly the types,
// effects and lookup entries whose IDs occur in the compiled main module. The
// module and all of its expressions remain unchanged. Run in a timed child just
// like the CLI; this adapter uses the pinned Quint 0.33.0 pipeline.
if (process.argv[2] === '--verify-memory') {
  const commands = require(join(dirname(pkg), 'dist/src/cliCommands.js'))
  const { parseServerEndpoint } = require(join(dirname(pkg), 'dist/src/apalache.js'))
  const args = JSON.parse(process.argv[3])
  args.serverEndpoint = parseServerEndpoint('localhost:8822').value
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
    console.log(`Memory checker metadata: ${reduced.types.size}/${compiled.types.size} live type entries`)
    result = await commands.verifySpec(reduced)
  }
  if (result.isLeft()) {
    console.error(result.value.msg)
    for (const error of result.value.stage?.errors ?? []) console.error(error.message ?? error)
  }
  process.exit(result.isLeft() ? 1 : 0)
}

const regressions = [
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
]

for (const file of readdirSync(join(root, 'specs')).filter(name => name.endsWith('.qnt')).toSorted()) {
  quint(['typecheck', `specs/${file}`])
}

if (!memoryOnly && !boundedOnly) {
  for (const file of ['follow', 'readstate']) {
    simulate(file, 'simulationStep', 'invariants', `${file}.itf.json`, false, true)
  }
  for (const [file, schedule, invariant, name, guardedInvariant = 'invariants'] of regressions) {
    simulate(file, `${schedule}Step`, guardedInvariant, `${name}.itf.json`)
    simulate(file, `${schedule}BugStep`, invariant, `${name}-bug.itf.json`, true)
  }
  simulate('readstate', 'stealthBugStep', 'stealthNeverMarks', 'stealth-bug.itf.json', true)
  for (const schedule of ['ambiguousFailure', 'pendingObservation', 'failedFirstSubscribe', 'unknownRoot', 'oldFollowActivity', 'oldFollowQuiet']) {
    simulate('follow', `${schedule}Step`, 'invariants', `${schedule}.itf.json`)
  }
  simulate('readstate', 'coalesceStep', 'coalescingSafety', 'read-coalesce.itf.json')
  for (const schedule of ['retryAfterAccept', 'stealthThenMark']) {
    simulate('readstate', `${schedule}Step`, 'invariants', `read-${schedule}.itf.json`)
  }
}

// WP2 uses real transactions for both random runs and directed failure pairs.
if (!boundedOnly) {
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
    ['fastCompactor', 'requestCoverageDeclared'],
    ['editedJob', 'nodeInputsCurrent'],
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
  ]
  simulate('agent-memory', 'suiteStep', 'invariants', 'memory-corrected.itf.json', false, true,
    { ...memoryOptions, init: 'suiteInit', samples: 512, steps: 80,
      witnesses: ['reachedAgreement', ...memoryRegressions.map((_, index) => `case${index}`)], requireCompletion: true })
  for (const [schedule, invariant, init] of memoryRegressions) {
    const options = { ...memoryOptions, ...(init ? { init } : {}) }
    simulate('agent-memory', `${schedule}BugStep`, invariant, `memory-${schedule}-bug.itf.json`, true, false, options)
  }
}

if (!tracesOnly) {
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
    console.log(`Seed ${seed}; memory: 1000 random samples and all 25 corrected witnesses (unless --bounded).`)
    console.log('Temporal formulas are typechecked only. Drain bounds: follow 64, read 48, memory 64.')
  } else {
    if (!memoryOnly) {
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
    const memoryBounded = 'specs/agent-memory.qnt'
    quint(['verify', memoryBounded, '--main', 'agent_memory_bounded',
      '--step', 'boundedStep', '--invariant', 'boundedSafety', '--max-steps', '4',
      '--apalache-version', apalacheVersion, '--verbosity', '1'])
    for (const [step, violation] of [['boundedRaceBugStep', true], ['boundedRaceStep', false]]) {
      quint(['verify', memoryBounded, '--main', 'agent_memory_bounded',
        '--step', step, '--invariant', 'nodeInputsCurrent', '--max-steps', '6',
        '--apalache-version', apalacheVersion, '--verbosity', '1'], { violation })
    }
    console.log(`Mode: ${boundedOnly ? 'bounded Apalache' : 'simulator and bounded Apalache'}${memoryOnly ? ' (memory only)' : ''}.`)
    console.log('Memory bounds: 4 archive transitions; 6 publication-race transitions. Temporal liveness is typechecked only.')
  }
}
console.log(`Spec check runtime: ${((Date.now() - startedAt) / 1000).toFixed(1)} seconds (excludes machine-lock wait).`)
