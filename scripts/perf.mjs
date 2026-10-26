// The perf budgets, on the laptop (baseline checks) or the Mac (absolute budgets), under the exclusive heavy
// lock (docs/performance.md 7.3). A grep keeps the desktop-only workflow; --with-unit adds the package budgets.
//
//   bun run perf                          the package budgets, then every desktop scenario
//   bun run perf --unit                   the package budgets only
//   bun run perf -g "<scenario>"          matching desktop scenarios only
//   bun run perf --with-unit -g "..."     both
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(name)
  if (at !== -1) args.splice(at, 1)
  return at !== -1
}
const unitsOnly = flag('--unit')
const withUnit = flag('--with-unit')
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
if (unitsOnly || withUnit || args.length === 0) {
  const chosen = unitPerfFiles()
  // The large-seed budgets share one boot (packages/engine/test/perf/largeSeedEngine.ts), so they run in one process,
  // in bun's shuffled order; every other file runs alone.
  const shared = chosen.filter((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes('largeSeedEngine'))
  const groups = [...(shared.length > 0 ? [shared] : []), ...chosen.filter((file) => !shared.includes(file)).map((file) => [file])]
  for (const files of groups) {
    const pkg = /^(packages\/[^/]+)\//.exec(files[0])?.[1]
    if (pkg === undefined || files.some((file) => !file.startsWith(`${pkg}/`))) throw new Error(`Not package budget files of one package: ${files.join(', ')}`)
    const result = spawnSync('bun', ['test', '--no-isolate', '--timeout', '600000', ...files.map((file) => `./${file.slice(pkg.length + 1)}`)], { cwd: `${root}${pkg}`, env, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.signal) process.exit(1)
    failed ||= result.status ?? 1
  }
}
if (!unitsOnly) {
  const result = spawnSync('bun', ['run', '--cwd', 'apps/desktop', 'perf', ...args], { cwd: root, stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.signal) process.exit(1)
  failed ||= result.status ?? 1
}
process.exitCode = failed
