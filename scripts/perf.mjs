// The perf budgets, on the laptop (baseline checks) or the Mac (absolute budgets), under the exclusive heavy
// lock (docs/performance.md 7.3). A grep keeps the desktop-only workflow; --with-unit adds the package budgets.
//
//   bun run perf                          the package budgets, then every desktop scenario
//   bun run perf --unit                   the package budgets only
//   bun run perf -g "<scenario>"          matching desktop scenarios only
//   bun run perf --with-unit -g "..."     both
//   --unit-files <a,b>                    only these package budget files (repo paths; empty for none)
//   --no-desktop                          no desktop scenarios
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const take = (flag) => {
  const at = args.indexOf(flag)
  if (at === -1) return undefined
  const [, value] = args.splice(at, 2)
  return value ?? ''
}
const flag = (name) => {
  const at = args.indexOf(name)
  if (at !== -1) args.splice(at, 1)
  return at !== -1
}
const unitsOnly = flag('--unit')
const withUnit = flag('--with-unit')
const noDesktop = flag('--no-desktop')
const unitFiles = take('--unit-files')
if (unitsOnly && args.length > 0) throw new Error('Use bun run perf --unit, or bun run perf -g <desktop scenario>')

/**
 * The package budgets: the agent's and the engine's `*.perf.ts` files, which bun test's default pattern skips,
 * so they are named one by one (repo paths).
 */
function unitPerfFiles() {
  const listed = (dir) => readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true }).map(String)
    .filter((file) => file.endsWith('.perf.ts')).toSorted().map((file) => `${dir}/${file}`)
  return [...listed('packages/agent/test'), ...listed('packages/engine/test/perf')]
}

const env = { ...process.env, JUNO_PERF: '1', JUNO_BENCH: '1', JUNO_BENCH_STRICT: '1' }
let failed = 0
if (unitsOnly || withUnit || (args.length === 0 && !noDesktop)) {
  const chosen = unitFiles === undefined ? unitPerfFiles() : unitFiles.split(',').filter(Boolean)
  // The large-seed budgets share one boot (packages/engine/test/perf/largeSeedEngine.ts), so they run in one process,
  // in bun's shuffled order; every other file runs alone. Each file's outcome is printed for the nightly's input cache.
  const shared = chosen.filter((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes('largeSeedEngine'))
  const groups = [...(shared.length > 0 ? [shared] : []), ...chosen.filter((file) => !shared.includes(file)).map((file) => [file])]
  for (const files of groups) {
    const pkg = /^(packages\/[^/]+)\//.exec(files[0])?.[1]
    if (pkg === undefined || files.some((file) => !file.startsWith(`${pkg}/`))) throw new Error(`Not package budget files of one package: ${files.join(', ')}`)
    const result = spawnSync('bun', ['test', '--no-isolate', '--timeout', '600000', ...files.map((file) => `./${file.slice(pkg.length + 1)}`)], { cwd: `${root}${pkg}`, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    if (result.error) throw result.error
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    if (result.signal) process.exit(1)
    // bun test names each file on a line of its own before that file's results.
    const failedFiles = new Set()
    let current
    for (const line of `${result.stdout}\n${result.stderr}`.split('\n')) {
      const header = /^(\S+\.perf\.ts):$/.exec(line.trim())
      if (header) current = files.find((file) => file.endsWith(header[1].replace(/^\.\//, '')))
      else if (line.startsWith('(fail)')) failedFiles.add(current)
    }
    for (const file of files) console.log(`juno-perf-unit: ${JSON.stringify({ file, passed: result.status === 0 || (!failedFiles.has(file) && !failedFiles.has(undefined)) })}`)
    failed ||= result.status ?? 1
  }
}
if (!unitsOnly && !noDesktop) {
  const result = spawnSync('bun', ['run', '--cwd', 'apps/desktop', 'perf', ...args], { cwd: root, stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.signal) process.exit(1)
  failed ||= result.status ?? 1
}
process.exitCode = failed
