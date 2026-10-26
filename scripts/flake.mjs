// Repeats test specs many times in shared runner jobs to measure how
// often it fails, and keeps the traces of the failures.
//
//   bun run flake <spec...> [-g <title>] [--repeat 40] [--machines 2] [--workers n] [--stress]
//   bun run flake apps/desktop/e2e/sidebar-hold.spec.ts -g "order holds"
//   bun run flake apps/gallery/behaviour.spec.ts -g "rewritten Home" --repeat 50
//   bun run flake packages/engine/test/flows/follow-races.flow.test.ts -g "getView page" --repeat 200
//
// The repeats are split across runner jobs (`bun run remote --shards`), each
// running `--repeat-each` with no retries and its usual workers, so the tests
// run under the same load as a normal remote run. Traces of failures land in
// .remote/<run>/. Exits 1 if any repetition failed.
// Package tests use bun test's --rerun-each; its counts are executions.
// --stress runs them under JUNO_STRESS (scripts/remote/workers.sh): twice the workers, CPU burners, a throttled
// renderer and scaled default timeouts. A new or changed test passes `--stress --repeat 10` before it merges
// (docs/development.md, "Stress runs").

import { spawn } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { forwardSignals } from './remote/children.mjs'
import { stripVTControlCharacters } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The first suite whose folder holds every spec runs them.
const suites = [
  { dir: 'apps/desktop/dom/', script: 'test:dom', bun: true },
  { dir: 'apps/desktop/test/', script: 'test', bun: true },
  { dir: 'apps/desktop/', script: 'test:desktop' },
  { dir: 'apps/gallery/', script: 'test:gallery' },
  { dir: 'packages/', script: 'test', bun: true },
]

const argv = process.argv.slice(2)
const options = { repeat: 40, machines: 2, workers: undefined, grep: undefined, stress: false, specs: [] }
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index]
  if (arg === '--repeat') options.repeat = Number(argv[++index])
  else if (arg === '--machines') options.machines = Number(argv[++index])
  else if (arg === '--workers') options.workers = Number(argv[++index])
  else if (arg === '-g' || arg === '--grep') options.grep = argv[++index]
  else if (arg === '--stress') options.stress = true
  else if (!arg.startsWith('-')) options.specs.push(relative(root, resolve(process.cwd(), arg)))
  else {
    console.error(`flake: unknown argument ${arg}`)
    process.exit(2)
  }
}
const suite = suites.find((candidate) => options.specs.length > 0 && options.specs.every((spec) => spec.startsWith(candidate.dir)))
if (!suite || !(options.repeat >= 1) || !(options.machines >= 1 && options.machines <= 2)) {
  console.error('usage: bun run flake <specs, all in apps/desktop/e2e, apps/desktop/dom, apps/gallery or packages> [-g <title>] [--repeat 40] [--machines 1|2] [--workers n] [--stress]')
  process.exit(2)
}

const each = Math.ceil(options.repeat / options.machines)
const unit = suite.bun === true
// The gallery script ends in `--project=behaviour`, so spec paths may follow it.
// The unit runner takes bun test flags before `--files` and repository paths after it.
const runner = unit
  ? [`--rerun-each=${each}`, ...(options.grep ? ['-t', options.grep] : []), '--files', ...options.specs]
  : ['--retries=0', ...options.specs.map((spec) => spec.slice(suite.dir.length)), `--repeat-each=${each}`, '--trace=retain-on-failure', '--reporter=line', ...(options.grep ? ['-g', options.grep] : [])]
const env = options.workers ? ['--env', `JUNO_E2E_WORKERS=${options.workers}`, '--env', `JUNO_BROWSER_WORKERS=${options.workers}`, '--env', `GALLERY_WORKERS=${options.workers}`, '--env', `JUNO_TEST_WORKERS=${options.workers}`] : []
// GALLERY_SHIFT_ONLY=MediaViewer bun run flake apps/gallery/shift.spec.ts: the walk covers only those components.
if (process.env.GALLERY_SHIFT_ONLY) env.push('--env', `GALLERY_SHIFT_ONLY=${process.env.GALLERY_SHIFT_ONLY}`)
if (options.stress) env.push('--env', 'JUNO_STRESS=1')
const args = [join(root, 'scripts/remote.mjs'), ...(options.machines > 1 ? ['--shards', String(options.machines)] : []), ...env, suite.script, ...runner]
console.error(`flake: ${options.specs.join(' ')}${options.grep ? ` -g "${options.grep}"` : ''}, ${each} times on each of ${options.machines} job(s)${options.stress ? ', under stress' : ''}`)

const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 }
const failures = []
const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
forwardSignals([child])
for (const stream of [child.stdout, child.stderr]) {
  createInterface({ input: stream }).on('line', (line) => {
    console.log(line)
    const plain = stripVTControlCharacters(line).replace(/^\[\d+\/\d+\] /, '')
    if (unit) {
      // bun test ends with ` 12 pass` and ` 1 fail` lines and marks each failure `(fail) <describe> > <test>`.
      const total = /^\s*(\d+) (pass|fail|skip)$/.exec(plain)
      if (total) counts[{ pass: 'passed', fail: 'failed', skip: 'skipped' }[total[2]]] += Number(total[1])
      const failure = /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/.exec(plain)
      if (failure) failures.push(failure[1].trim())
      return
    }
    const total = /^\s*(\d+) (passed|failed|flaky|skipped)\b/.exec(plain)
    if (total) counts[total[2]] += Number(total[1])
    const failed = /^\s*\d+\) (.+)$/.exec(plain)
    if (failed && plain.includes('›')) failures.push(failed[1].trim())
  })
}
const code = await new Promise((resolvePromise) => child.on('close', (exit) => resolvePromise(exit ?? 1)))
const ran = counts.passed + counts.failed + counts.flaky
console.log(unit
  ? `\nflake: ${counts.failed} of ${ran} test executions failed, ${each} per test on each job; remote exited with ${code}`
  : `\nflake: ${counts.failed} of ${ran} failed${counts.skipped ? `, ${counts.skipped} skipped` : ''}; remote exited with ${code}`)
for (const failure of new Set(failures)) console.log(`  ${failure}`)
if (ran === 0) console.log('flake: no results were read; see the output above')
process.exit(counts.failed > 0 || ran === 0 || code !== 0 ? 1 : 0)
