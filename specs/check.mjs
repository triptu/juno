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
  const result = spawnSync(process.execPath, [cli, ...commandArgs], {
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
}

function simulate(file, step, invariant, output, violation = false, randomized = false) {
  const path = join(generated, output)
  rmSync(path, { force: true })
  quint(['run', `specs/${file}.qnt`, '--step', step, '--invariant', invariant,
    '--backend', backend, '--n-threads', '2', '--seed', seed, '--max-samples', String(randomized ? samples : 1),
    '--max-steps', String(randomized ? steps : 80), '--verbosity', '1',
    '--out-itf', path, '--mbt', ...(randomized ? ['--witnesses', 'reachedAgreement'] : [])], { violation })
  const trace = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(trace.states) || trace.states.length < 2) throw new Error(`No usable trace in ${path}`)
  console.log(`${violation ? 'Expected counterexample' : 'Example trace'}: specs/traces/${output}`)
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
    console.log(`Correct protocols: ${samples} samples each, up to ${steps} steps, seed ${seed}.`)
    console.log('Temporal formulas are typechecked. Simulation checks follow/read drain bounds of 64/40 steps, not unbounded liveness.')
  } else {
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
    console.log('Mode: randomized simulator and Apalache (small instances: 4 steps; four races, old and fixed: 5 steps).')
    console.log('Unbounded temporal liveness is not checked. Simulation checks follow/read drain bounds of 64/40 steps.')
  }
}
console.log(`Spec check runtime: ${((Date.now() - startedAt) / 1000).toFixed(1)} seconds (excludes machine-lock wait).`)
