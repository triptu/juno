// The conformance run (README, "Conformance"): Quint generates traces of
// `outbox.qnt`, and the engine harness (packages/engine/test/conformance)
// replays each one against the engine and the fake Slack, comparing the
// two after every round.
//
//   node specs/conformance.mjs             generate, then replay
//   node specs/conformance.mjs --generate  generate only
//
// CONFORMANCE_ONLY=<part of a file name> replays only the matching traces.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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
  actionRetry: 'a difference: after a lost answer the client sends the old text again before the worker sends the new one',
}
// Broken schedules whose bug the projection cannot see.
const unseen = {
  actionBeforeStore: 'the call with a guessed ts would wait for the send lane behind the post, and the trace ends there',
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

function quint(args, violation) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'run', ...args, '--backend', process.env.QUINT_SIMULATOR ?? 'rust', '--n-threads', '1', '--seed', seed, '--mbt', '--verbosity', '1'], { cwd: root })
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
  const corrected = `outbox-${schedule}.itf.json`
  jobs.push(directed(`${schedule}Step`, 'invariants', corrected, false))
  manifest.push({ file: corrected, kind: 'corrected', ...(unmapped[schedule] ? { skip: unmapped[schedule] } : {}) })
  if (invariant === undefined) continue
  jobs.push(directed(`${schedule}BugStep`, invariant, `outbox-${schedule}-bug.itf.json`, true))
  const skip = unmapped[schedule] ?? unseen[schedule]
  manifest.push({ file: `outbox-${schedule}-bug.itf.json`, kind: 'bug', corrected, ...(skip ? { skip } : {}) })
}

const lanes = Math.max(1, Number(process.env.SPECS_JOBS ?? 4))
await Promise.all(Array.from({ length: lanes }, async () => {
  while (jobs.length > 0) await jobs.shift()()
}))
writeFileSync(join(out, 'outbox.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Generated ${manifest.length} outbox traces in ${((Date.now() - startedAt) / 1000).toFixed(1)} s (seed ${seed}).`)

if (!process.argv.includes('--generate')) {
  const status = await new Promise((resolve) => {
    const child = spawn('pnpm', ['--filter', '@juno/engine', 'exec', 'vitest', 'run', '--config', 'vitest.conformance.config.ts'], { cwd: root, stdio: 'inherit' })
    child.on('close', resolve)
  })
  console.log(`Conformance runtime: ${((Date.now() - startedAt) / 1000).toFixed(1)} seconds (excludes machine-lock wait).`)
  process.exit(status ?? 1)
}
