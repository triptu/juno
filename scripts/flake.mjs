// Repeats one Playwright spec many times on remote machines to measure how
// often it fails, and keeps the traces of the failures.
//
//   pnpm flake <spec...> [-g <title>] [--repeat 40] [--machines 2] [--workers n]
//   pnpm flake apps/desktop/e2e/sidebar.spec.ts -g scrollbar
//   pnpm flake apps/gallery/behaviour.spec.ts -g "rewritten Home" --repeat 50
//
// The repeats are split across the machines (`pnpm remote --shards`), each
// running `--repeat-each` with no retries and its usual workers, so the tests
// run under the same load as a normal remote run. Traces of failures land in
// .remote/<run>/. Exits 1 if any repetition failed.

import { spawn } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suites = [
  { dir: 'apps/desktop/', script: 'test:desktop' },
  { dir: 'apps/gallery/', script: 'test:gallery' },
]

const argv = process.argv.slice(2)
const options = { repeat: 40, machines: 2, workers: undefined, grep: undefined, specs: [] }
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index]
  if (arg === '--repeat') options.repeat = Number(argv[++index])
  else if (arg === '--machines') options.machines = Number(argv[++index])
  else if (arg === '--workers') options.workers = Number(argv[++index])
  else if (arg === '-g' || arg === '--grep') options.grep = argv[++index]
  else if (!arg.startsWith('-')) options.specs.push(relative(root, resolve(process.cwd(), arg)))
  else {
    console.error(`flake: unknown argument ${arg}`)
    process.exit(2)
  }
}
const suite = suites.find((candidate) => options.specs.length > 0 && options.specs.every((spec) => spec.startsWith(candidate.dir)))
if (!suite || !(options.repeat >= 1) || !(options.machines >= 1 && options.machines <= 2)) {
  console.error('usage: pnpm flake <specs, all in apps/desktop/e2e or all in apps/gallery> [-g <title>] [--repeat 40] [--machines 1|2] [--workers n]')
  process.exit(2)
}

const each = Math.ceil(options.repeat / options.machines)
// The gallery script ends in `--project behaviour`, which takes every word after it,
// so an option has to come before the spec paths.
const playwright = ['--retries=0', ...options.specs.map((spec) => spec.slice(suite.dir.length)), `--repeat-each=${each}`, '--trace=retain-on-failure', '--reporter=line']
if (options.grep) playwright.push('-g', options.grep)
const env = options.workers ? ['--env', `JUNO_E2E_WORKERS=${options.workers}`, '--env', `GALLERY_WORKERS=${options.workers}`] : []
const args = [join(root, 'scripts/remote.mjs'), ...(options.machines > 1 ? ['--shards', String(options.machines)] : []), ...env, suite.script, ...playwright]
console.error(`flake: ${options.specs.join(' ')}${options.grep ? ` -g "${options.grep}"` : ''}, ${each} times on each of ${options.machines} machine(s)`)

const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 }
const failures = []
const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
for (const stream of [child.stdout, child.stderr]) {
  createInterface({ input: stream }).on('line', (line) => {
    console.log(line)
    const plain = line.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\[\d+\/\d+\] /, '')
    const total = /^\s*(\d+) (passed|failed|flaky|skipped)\b/.exec(plain)
    if (total) counts[total[2]] += Number(total[1])
    const failed = /^\s*\d+\) (.+)$/.exec(plain)
    if (failed && plain.includes('›')) failures.push(failed[1].trim())
  })
}
const code = await new Promise((resolvePromise) => child.on('close', (exit) => resolvePromise(exit ?? 1)))
const ran = counts.passed + counts.failed + counts.flaky
console.log(`\nflake: ${counts.failed} of ${ran} failed${counts.skipped ? `, ${counts.skipped} skipped` : ''}; remote exited with ${code}`)
for (const failure of new Set(failures)) console.log(`  ${failure}`)
if (ran === 0) console.log('flake: no results were read; see the output above')
process.exit(counts.failed > 0 || ran === 0 || code !== 0 ? 1 : 0)
