// Runs a command only when a machine-wide "heavy job" slot is free.
//
//   node scripts/heavy.mjs <command> [args...]
//
// Tests, e2e runs, gallery shots, benchmarks and spec checks are heavy: each
// spawns many processes. Several agents work in separate worktrees on one
// machine, so without a shared queue they all run at once and the machine stalls.
// The lock lives outside the repo, so every worktree shares it.
//
// JUNO_HEAVY_SLOTS sets how many heavy jobs may run at once (default 2; --electron also takes the single app-launch slot).
// JUNO_HEAVY_HELD=1 is set for the child, so nested heavy commands do not wait
// on their own parent.
//
// `--exclusive` before the command takes every slot, for timing runs (perf,
// feel) that must have the machine to themselves. While one waits, no new job
// starts, so it is not starved.

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// `--queue <name>` uses a separate lock with its own two slots, for short jobs
// that must not pile up but should not wait behind test runs (typecheck).
const queueAt = process.argv[2] === '--queue' ? process.argv[3] : undefined
const rest = process.argv.slice(queueAt ? 4 : 2)
const flags = rest.slice(0, rest.findIndex((arg) => !arg.startsWith('--')) === -1 ? rest.length : rest.findIndex((arg) => !arg.startsWith('--')))
const exclusive = flags.includes('--exclusive')
const electron = flags.includes('--electron') && process.platform === 'darwin'
const args = rest.slice(flags.length)
if (args.length === 0) {
  console.error('usage: node scripts/heavy.mjs <command> [args...]')
  process.exit(2)
}

const run = () => {
  const child = spawn(args[0], args.slice(1), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, JUNO_HEAVY_HELD: '1' },
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  return new Promise((resolve) => child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))))
}

if (process.env.JUNO_HEAVY_HELD === '1') process.exit(await run())

const root = join(tmpdir(), queueAt ? `juno-heavy-${queueAt}` : 'juno-heavy')
const slots = queueAt ? 2 : Math.max(1, Number(process.env.JUNO_HEAVY_SLOTS ?? 2))
const label = `${args.join(' ')} (${process.cwd()})`
mkdirSync(root, { recursive: true })

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// mkdir is atomic, so a slot is owned by whoever creates its directory first.
const take = (dir) => {
  try {
    mkdirSync(dir)
    writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, label, since: new Date().toISOString() }))
    return true
  } catch {
    // Taken. Free it if its owner died without releasing it.
    try {
      const owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'))
      if (!alive(owner.pid)) rmSync(dir, { recursive: true, force: true })
    } catch {
      // The owner is still writing its file; try again on the next poll.
    }
    return false
  }
}

// An exclusive job waiting or running holds `drain`; ordinary jobs wait for it.
const drain = join(root, 'drain')
const draining = () => {
  try {
    return alive(JSON.parse(readFileSync(join(drain, 'owner.json'), 'utf8')).pid)
  } catch {
    return false
  }
}

const held = []
const tryAcquire = () => {
  if (exclusive) {
    if (held.length === 0 && !take(drain)) return undefined
    if (held.length === 0) held.push(drain)
    for (let index = held.length - 1; index < slots; index++) {
      if (!take(join(root, `slot-${index}`))) return undefined
      held.push(join(root, `slot-${index}`))
    }
    return held
  }
  if (draining()) return undefined
  const appSlot = join(root, 'electron')
  if (electron && !take(appSlot)) return undefined
  for (let index = 0; index < slots; index++) {
    const dir = join(root, `slot-${index}`)
    if (take(dir)) return electron ? [dir, appSlot] : [dir]
  }
  if (electron) rmSync(appSlot, { recursive: true, force: true })
  return undefined
}

const holders = () => {
  const list = []
  for (let index = 0; index < slots; index++) {
    try {
      list.push(JSON.parse(readFileSync(join(root, `slot-${index}`, 'owner.json'), 'utf8')).label)
    } catch {
      // Empty or being written.
    }
  }
  return list.join('; ')
}

let slot = tryAcquire()
let waited = 0
while (!slot) {
  if (waited % 30 === 0) console.error(`heavy: waiting for a free slot. Running now: ${holders() || 'unknown'}`)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  waited += 2
  slot = tryAcquire()
}

const release = () => {
  for (const dir of slot) rmSync(dir, { recursive: true, force: true })
}
process.on('exit', release)
const code = await run()
release()
process.exit(code)
