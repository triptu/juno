// The perf budgets, on the laptop (baseline checks) or the Mac (absolute budgets), under the exclusive heavy
// lock (docs/performance.md 7.3). A grep keeps the desktop-only workflow; --with-unit adds the package budgets.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const unitsOnly = args[0] === '--unit'
if (unitsOnly && args.length !== 1) throw new Error('Use bun run perf --unit, or bun run perf -g <desktop scenario>')
// --with-unit keeps the package budgets beside a desktop selection, as the nightly does.
const withUnit = args.includes('--with-unit')
const desktopArgs = args.filter((arg) => arg !== '--with-unit')
const commands = []
if (args.length === 0 || unitsOnly || withUnit) {
  // The agent's budgets are its `*.perf.ts` files, which bun test's default pattern skips, so they are named one by one.
  const agentPerf = readdirSync(fileURLToPath(new URL('../packages/agent/test', import.meta.url)), { recursive: true })
    .filter((file) => file.endsWith('.perf.ts')).toSorted().map((file) => `./test/${file}`)
  commands.push({ cwd: 'packages/agent', args: ['test', '--timeout', '600000', ...agentPerf] })
  // The engine's budgets, one file after another: the idle checks and the large-seed benchmarks.
  const enginePerf = readdirSync(fileURLToPath(new URL('../packages/engine/test/perf', import.meta.url)))
    .filter((file) => file.endsWith('.perf.ts')).toSorted().map((file) => `./test/perf/${file}`)
  commands.push({ cwd: 'packages/engine', args: ['test', '--timeout', '600000', ...enginePerf] })
}
if (!unitsOnly) commands.push({ args: ['run', '--cwd', 'apps/desktop', 'perf', ...desktopArgs] })
let failed = 0
for (const command of commands) {
  const cwd = command.cwd === undefined ? undefined : fileURLToPath(new URL(`../${command.cwd}`, import.meta.url))
  const result = spawnSync('bun', command.args, { cwd, stdio: 'inherit', env: { ...process.env, JUNO_PERF: '1', JUNO_BENCH: '1', JUNO_BENCH_STRICT: '1' } })
  if (result.error) throw result.error
  if (result.signal) process.exit(1)
  failed ||= result.status ?? 1
}
process.exitCode = failed
