// The conformance run (README, "Conformance"): Quint generates traces of
// `outbox.qnt`, and the engine harness (packages/engine/test/conformance)
// replays each one against the engine and the fake Slack, comparing the
// two after every round.
//
//   bun specs/conformance.mjs             generate, then replay
//   bun specs/conformance.mjs --generate  generate only
//
// CONFORMANCE_ONLY=<part of a file name> replays only the matching traces.
//
// Each Quint run's traces are cached as specs:check caches its runs: in
// SPECS_CACHE_DIR (bun run remote carries it along and back) or the system temp
// folder, keyed by the run's arguments, the spec and what it imports, and
// the Quint version. SPECS_CACHE=off or --no-cache generates everything.
// CONFORMANCE_JOBS sets how many Quint runs go at once (default: cores, at most 4).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { availableParallelism, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outboxPairs, outboxSchedules } from './outbox-checks.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('@informalsystems/quint/package.json')), 'dist/src/cli.js')
const out = join(root, 'specs/traces/conformance')
const seed = '20261016'
const startedAt = Date.now()
// Random traces per family, and their length. The replay cuts each one at
// its last round that ended, which leaves about 20 steps.
const samples = 25
const steps = 24
// Directed schedules the harness does not replay, and why (README, "Conformance").
const unmapped = {
  uploadRetry: 'uploads: the harness sends no files',
  sameText: 'not in Juno\'s order: Juno claims the first post before the second is sent',
  actionOnDiscarded: 'not in Juno\'s order: Juno puts the edit into the refused row at once, before the discard',
  crashResend: 'the crash leaves the socket up; the engine\'s restart also reads history, so it stores the post with no lookup',
  reconnectPage: 'depends on timing: the catch-up stores the post before the lookup\'s 2 s are up',
  reactionOnGone: 'reactions: the harness replays every change as an edit',
  actionRetry: 'a difference: after a lost answer the client sends the old text again before the worker sends the new one',
}
// Broken schedules whose bug the projection cannot see.
const unseen = {
  actionBeforeStore: 'the call with a guessed ts would wait for the send lane behind the post, and the trace ends there',
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const backend = process.env.QUINT_SIMULATOR ?? 'rust'
const cacheDir = process.env.SPECS_CACHE_DIR ?? join(tmpdir(), 'juno-cache', 'specs')
const useCache = process.env.SPECS_CACHE !== 'off' && !process.argv.includes('--no-cache')
// Bump when what a run writes, or how its traces are read back, changes.
const cacheVersion = 1
const sha = (...parts) => {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(String(part)).update('\0')
  return hash.digest('hex')
}
function specHash(file, seen = new Set()) {
  if (seen.has(file)) return ''
  seen.add(file)
  const text = readFileSync(join(root, file), 'utf8')
  const imports = [...text.matchAll(/from\s+"\.\/([\w-]+)(?:\.qnt)?"/g)].map((match) => `specs/${match[1]}.qnt`)
  return sha(text, ...imports.map((name) => specHash(name, seen)))
}
const quintVersion = require('@informalsystems/quint/package.json').version
let cachedRuns = 0

// The trace files a run wrote: its `--out-itf` name, with `{seq}` for any number.
function written(itf) {
  const pattern = new RegExp(`^${basename(itf).replace(/[.]/g, '\\.').replace('{seq}', '\\d+')}$`)
  return readdirSync(out).filter((name) => pattern.test(name))
}

async function quint(args, violation) {
  const itf = args[args.indexOf('--out-itf') + 1]
  // The output directory is not part of the key: worktrees share the cache.
  const keyArgs = args.map((arg) => (arg === itf ? basename(itf) : arg))
  const key = sha('conformance', cacheVersion, quintVersion, backend, seed, violation, JSON.stringify(keyArgs), specHash(args[0]))
  const cached = join(cacheDir, `conformance-${key}.json`)
  if (useCache && existsSync(cached)) {
    const saved = JSON.parse(readFileSync(cached, 'utf8'))
    for (const [name, text] of Object.entries(saved.files)) writeFileSync(join(out, name), text)
    cachedRuns += 1
    return
  }
  await run(args, violation)
  if (!useCache) return
  const files = Object.fromEntries(written(itf).map((name) => [name, readFileSync(join(out, name), 'utf8')]))
  if (Object.keys(files).length === 0) throw new Error(`quint run ${args.join(' ')} wrote no trace`)
  mkdirSync(cacheDir, { recursive: true })
  const temporary = `${cached}.${process.pid}`
  writeFileSync(temporary, JSON.stringify({ files }))
  renameSync(temporary, cached)
}

function run(args, violation) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'run', ...args, '--backend', backend, '--n-threads', '1', '--seed', seed, '--mbt', '--verbosity', '1'], { cwd: root })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('close', (status) => {
      const ok = violation ? status === 1 && /Invariant violated|found a counterexample/.test(output) : status === 0
      if (ok) resolve()
      else reject(new Error(`quint run ${args.join(' ')} ${violation ? 'found no counterexample' : `failed with status ${status}`}\n${output}`))
    })
  })
}

const manifest = []
const jobs = []
for (const [family, step] of [['random', 'conformanceStep'], ['copy', 'copyStep']]) {
  jobs.push(() =>
    quint(['specs/outbox-conformance.qnt', '--main', 'outbox_conformance', '--init', 'conformanceInit', '--step', step, '--invariant', 'invariants',
      '--max-samples', String(samples), '--n-traces', String(samples), '--max-steps', String(steps), '--out-itf', join(out, `outbox-${family}-{seq}.itf.json`)], false))
  for (let i = 0; i < samples; i++) manifest.push({ file: `outbox-${family}-${i}.itf.json`, kind: 'random' })
}
const directed = (step, invariant, file, violation) => () =>
  quint(['specs/outbox.qnt', '--step', step, '--invariant', invariant, '--max-samples', '1', '--max-steps', '80', '--out-itf', join(out, file)], violation)
for (const [schedule, invariant] of [...outboxPairs, ...outboxSchedules.map((name) => [name])]) {
  // A trace the harness does not replay is not generated: specs:check runs these schedules.
  const corrected = `outbox-${schedule}.itf.json`
  const bug = invariant === undefined ? undefined : `outbox-${schedule}-bug.itf.json`
  const bugSkip = unmapped[schedule] ?? unseen[schedule]
  if (unmapped[schedule] === undefined) jobs.push(directed(`${schedule}Step`, 'invariants', corrected, false))
  manifest.push({ file: corrected, kind: 'corrected', ...(unmapped[schedule] ? { skip: unmapped[schedule] } : {}) })
  if (bug === undefined) continue
  if (bugSkip === undefined) jobs.push(directed(`${schedule}BugStep`, invariant, bug, true))
  manifest.push({ file: bug, kind: 'bug', corrected, ...(bugSkip ? { skip: bugSkip } : {}) })
}

const runs = jobs.length
const lanes = Math.max(1, Number(process.env.CONFORMANCE_JOBS ?? Math.min(4, availableParallelism())))
await Promise.all(Array.from({ length: lanes }, async () => {
  while (jobs.length > 0) await jobs.shift()()
}))
writeFileSync(join(out, 'outbox.json'), `${JSON.stringify(manifest, null, 2)}\n`)
const replayed = manifest.filter((entry) => entry.skip === undefined).length
console.log(`Generated ${replayed} outbox traces (${manifest.length - replayed} not replayed) in ${((Date.now() - startedAt) / 1000).toFixed(1)} s (seed ${seed}, ${cachedRuns} of ${runs} Quint runs cached).`)

if (!process.argv.includes('--generate')) {
  const status = await new Promise((resolve) => {
    // Each file holds one shard of the replays (outbox-suite.ts) and gets its own process; a file's
    // replays run concurrently, at most JUNO_CONFORMANCE_CONCURRENCY at once.
    const files = readdirSync(join(root, 'packages/engine/test/conformance')).filter((name) => name.endsWith('.conformance.ts')).map((name) => `./test/conformance/${name}`)
    const workers = Number(process.env.JUNO_TEST_WORKERS ?? 2)
    const concurrency = Number(process.env.JUNO_CONFORMANCE_CONCURRENCY ?? 6)
    const child = spawn('bun', ['test', `--parallel=${Math.min(workers, files.length)}`, `--max-concurrency=${concurrency}`, '--timeout=600000', ...files], { cwd: join(root, 'packages/engine'), stdio: 'inherit' })
    child.on('close', resolve)
  })
  console.log(`Conformance runtime: ${((Date.now() - startedAt) / 1000).toFixed(1)} seconds (excludes machine-lock wait).`)
  process.exit(status ?? 1)
}
