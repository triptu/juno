// Keep timing assertions outside concurrent package tests on small machines.
import { spawn } from 'node:child_process'

const jobs = Number(process.env.JUNO_TEST_PACKAGE_JOBS ?? 2)
if (!Number.isSafeInteger(jobs) || jobs < 1) throw new Error('JUNO_TEST_PACKAGE_JOBS must be a positive integer')
const args = process.argv.slice(2)
const separateTiming = process.env.JUNO_TEST_TIMING_SEPARATE === '1' && args.length === 0
let child
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child?.kill(signal))
const run = (command) => new Promise((resolve) => {
  child = spawn('pnpm', command, { stdio: 'inherit' })
  child.on('error', (error) => { console.error(error.message); resolve(1) })
  child.on('close', (code) => resolve(code ?? 1))
})
const code = await run(['-r', `--workspace-concurrency=${jobs}`, '--if-present', 'test', ...args, ...(separateTiming ? ['--exclude', '**/serve/chat-cache.bench.test.ts'] : [])])
process.exitCode = code || (separateTiming ? await run(['--filter', '@juno/agent', 'test', '--project', 'agent-timing']) : 0)
