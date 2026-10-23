// Budget checks share the Mac's exclusive heavy lock. A grep keeps the existing desktop-only workflow.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
if (process.platform !== 'darwin') throw new Error('Performance budgets run on the Mac. Use bun run test for correctness.')
const unitsOnly = args[0] === '--unit'
if (unitsOnly && args.length !== 1) throw new Error('Use bun run perf --unit, or bun run perf -g <desktop scenario>')
const commands = []
if (args.length === 0 || unitsOnly) {
  // The agent's budgets are its `*.perf.ts` files, which bun test's default pattern skips, so they are named one by one.
  const agentPerf = readdirSync(fileURLToPath(new URL('../packages/agent/test', import.meta.url)), { recursive: true })
    .filter((file) => file.endsWith('.perf.ts')).toSorted().map((file) => `./test/${file}`)
  commands.push({ cwd: 'packages/agent', args: ['test', '--timeout', '600000', ...agentPerf] })
  commands.push({ args: ['run', '--cwd', 'packages/engine', 'vitest', 'run', '-c', 'vitest.perf.config.ts'] })
  commands.push({ args: ['run', '--cwd', 'packages/engine', 'vitest', 'run', 'test/bench', '--silent=false'] })
}
if (!unitsOnly) commands.push({ args: ['run', '--cwd', 'apps/desktop', 'perf', ...args] })
let failed = 0
for (const command of commands) {
  const cwd = command.cwd === undefined ? undefined : fileURLToPath(new URL(`../${command.cwd}`, import.meta.url))
  const result = spawnSync('bun', command.args, { cwd, stdio: 'inherit', env: { ...process.env, JUNO_PERF: '1', JUNO_BENCH: '1', JUNO_BENCH_STRICT: '1', JUNO_TEST_FILE_PARALLEL: '0', JUNO_VITEST_WORKERS: '1' } })
  if (result.error) throw result.error
  if (result.signal) process.exit(1)
  failed ||= result.status ?? 1
}
process.exitCode = failed
