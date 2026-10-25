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
import { readdirSync } from 'node:fs'
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

let failed = 0
if (unitsOnly || withUnit || (args.length === 0 && !noDesktop)) {
  const chosen = unitFiles === undefined ? unitPerfFiles() : unitFiles.split(',').filter(Boolean)
  // One process per file, one after another, so each prints its own outcome for the nightly's input cache.
  for (const file of chosen) {
    const [, pkg, rest] = /^(packages\/[^/]+)\/(.+)$/.exec(file) ?? []
    if (pkg === undefined) throw new Error(`Not a package budget file: ${file}`)
    const result = spawnSync('bun', ['test', '--timeout', '600000', `./${rest}`], { cwd: `${root}${pkg}`, stdio: 'inherit', env: { ...process.env, JUNO_PERF: '1', JUNO_BENCH: '1', JUNO_BENCH_STRICT: '1' } })
    if (result.error) throw result.error
    if (result.signal) process.exit(1)
    console.log(`juno-perf-unit: ${JSON.stringify({ file, passed: result.status === 0 })}`)
    failed ||= result.status ?? 1
  }
}
if (!unitsOnly && !noDesktop) {
  const result = spawnSync('bun', ['run', '--cwd', 'apps/desktop', 'perf', ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, JUNO_PERF: '1', JUNO_BENCH: '1', JUNO_BENCH_STRICT: '1' } })
  if (result.error) throw result.error
  if (result.signal) process.exit(1)
  failed ||= result.status ?? 1
}
process.exitCode = failed
