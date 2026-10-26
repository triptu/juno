// Sequential laptop runs at one commit, one per desktop/unit/gallery core split. Do not tune from one job's time alone.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { git, statusFolder } from './release-gate.mjs'
import { forwardSignals } from './remote/children.mjs'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const commit = git(root, 'rev-parse', args.includes('--ref') ? args[args.indexOf('--ref') + 1] : 'origin/main')
const scripts = JSON.parse(git(root, 'show', `${commit}:package.json`)).scripts
const splits = [[3, 2, 3], [3, 3, 2], [2, 3, 3], [3, 2, 3]]
const plan = { commit, splits: splits.map(([desktop, unit, gallery]) => ({ desktop, unit, gallery })), specs: 'reuse unchanged inputs',
  measures: ['whole-run wall seconds', 'per-suite seconds', 'allocator waits', 'peak container memory', 'CPU pressure', 'failure causes', 'per-test durations'],
  pending: !(scripts['test:browser'] && scripts['test:electron']) }
console.log(JSON.stringify(plan, null, 2))
if (args.includes('--dry-run') || plan.pending) {
  if (plan.pending) console.log('Pending: land the browser and Electron lanes on main before spending laptop time.')
  process.exit(0)
}
const folder = join(statusFolder(root), 'verify-benchmarks', new Date().toISOString().replaceAll(':', '-'))
mkdirSync(folder, { recursive: true })
const children = new Set()
forwardSignals(children)
let cancelled = false
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cancelled = true })
const runs = []
for (const [desktop, unit, gallery] of splits) {
  if (cancelled) break
  const started = Date.now()
  const code = await new Promise((done) => {
    const child = spawn('bun', ['run', 'verify:main', '--ref', commit, '--require-remote'], {
      cwd: root, stdio: 'inherit', env: { ...process.env, JUNO_RUNNER_DESKTOP_CORES: String(desktop), JUNO_RUNNER_UNIT_CORES: String(unit), JUNO_RUNNER_GALLERY_CORES: String(gallery) },
    })
    children.add(child)
    child.on('error', () => {})
    child.on('close', (code) => { children.delete(child); done(code ?? 130) })
  })
  const record = JSON.parse(readFileSync(join(statusFolder(root), 'verify-main.json'), 'utf8'))
  if (record.commit !== commit || Date.parse(record.finishedAt) < started) throw new Error('Benchmark did not produce a record for this run')
  runs.push({ desktop, unit, gallery, code, wallSeconds: (Date.now() - started) / 1000, record })
  writeFileSync(join(folder, 'results.json'), JSON.stringify({ ...plan, runs }, null, 2) + '\n')
  // A failed run is evidence to fix, never a reason to loop until green.
  if (code !== 0) { process.exitCode = code; break }
}
console.log(`Benchmark records: ${folder}`)
