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
const apalacheVersion = '0.62.1' // Quint 0.33.0's default distribution.
const generated = join(root, 'specs/traces')
mkdirSync(generated, { recursive: true })

function quint(args, { violation = false } = {}) {
  console.log(`quint ${args.join(' ')}`)
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  })
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
    '--backend', backend, '--seed', seed, '--max-samples', String(randomized ? samples : 1),
    '--max-steps', String(randomized ? steps : 60), '--verbosity', '1',
    '--out-itf', path, '--mbt', ...(randomized ? ['--witnesses', 'reachedAgreement'] : [])], { violation })
  const trace = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(trace.states) || trace.states.length < 2) throw new Error(`No usable trace in ${path}`)
  console.log(`${violation ? 'Expected counterexample' : 'Example trace'}: specs/traces/${output}`)
}

const regressions = [
  ['follow', 'stalePage', 'acceptedUnfollow', 'stale-follow-page'],
  ['follow', 'missedUnfollow', 'quietAgreement', 'missed-unfollow'],
  ['follow', 'missedFollow', 'quietAgreement', 'single-page'],
  ['readstate', 'lateMark', 'acceptedUnreadProtected', 'late-read-event'],
  ['readstate', 'latePage', 'acceptedUnreadProtected', 'late-read-page'],
  ['readstate', 'pendingMark', 'quietAgreement', 'pending-read-event'],
]

for (const file of readdirSync(join(root, 'specs')).filter(name => name.endsWith('.qnt')).toSorted()) {
  quint(['typecheck', `specs/${file}`])
}

for (const file of ['follow', 'readstate']) {
  simulate(file, 'simulationStep', 'invariants', `${file}.itf.json`, false, true)
}
for (const [file, schedule, invariant, name] of regressions) {
  simulate(file, `${schedule}Step`, 'invariants', `${name}.itf.json`)
  simulate(file, `${schedule}BugStep`, invariant, `${name}-bug.itf.json`, true)
}
simulate('readstate', 'stealthBugStep', 'stealthNeverMarks', 'stealth-bug.itf.json', true)

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
  const javaPath = javaCandidates.find((candidate) => spawnSync(candidate, ['-version'], { encoding: 'utf8' }).status === 0)
  if (javaPath && javaPath !== 'java') {
    process.env.PATH = `${dirname(javaPath)}:${process.env.PATH}`
    process.env.JAVA_HOME = dirname(dirname(javaPath))
  }
  // Quint downloads Apalache on the first `verify` when it is missing.
  if (!javaPath) {
    console.log('Mode: randomized simulator only (Java unavailable).')
    console.log(`Correct protocols: ${samples} samples each, up to ${steps} steps, seed ${seed}.`)
    console.log('The temporal formula is typechecked. The simulator checks its 40-step drain bound, not unbounded liveness.')
  } else {
    for (const file of ['follow', 'readstate']) {
      quint(['verify', `specs/${file}.qnt`, '--invariant', 'invariants', '--max-steps', '12',
        '--apalache-version', apalacheVersion, '--verbosity', '1'])
    }
    for (const [file, schedule, invariant] of regressions) {
      quint(['verify', `specs/${file}.qnt`, '--step', `${schedule}BugStep`, '--invariant', invariant,
        '--max-steps', '30', '--apalache-version', apalacheVersion, '--verbosity', '1'], { violation: true })
    }
    console.log('Mode: randomized simulator and Apalache bounded model checker (correct protocol: 12 steps).')
    console.log('Unbounded temporal liveness is not checked. The 40-step drain bound is checked by simulation.')
  }
}
