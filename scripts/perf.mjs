// Budget checks share the Mac's exclusive heavy lock. A grep keeps the existing desktop-only workflow.
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
if (process.platform !== 'darwin') throw new Error('Performance budgets run on the Mac. Use pnpm test for correctness.')
const unitsOnly = args[0] === '--unit'
if (unitsOnly && args.length !== 1) throw new Error('Use pnpm perf --unit, or pnpm perf -g <desktop scenario>')
const commands = []
if (args.length === 0 || unitsOnly) {
  for (const name of ['agent', 'engine', 'ai']) commands.push(['--filter', `@juno/${name}`, 'exec', 'vitest', 'run', '-c', 'vitest.perf.config.ts'])
  commands.push(['--filter', '@juno/engine', 'exec', 'vitest', 'run', 'test/bench', '--silent=false'])
}
if (!unitsOnly) commands.push(['--filter', '@juno/desktop', 'perf', ...args])
let failed = 0
for (const command of commands) {
  const result = spawnSync('pnpm', command, { stdio: 'inherit', env: { ...process.env, JUNO_PERF: '1', JUNO_BENCH: '1', JUNO_BENCH_STRICT: '1', JUNO_TEST_FILE_PARALLEL: '0', JUNO_VITEST_WORKERS: '1' } })
  if (result.error) throw result.error
  if (result.signal) process.exit(1)
  failed ||= result.status ?? 1
}
process.exitCode = failed
