// Runs a command only when a machine-wide "heavy job" slot is free.
//
//   node scripts/heavy.mjs <command> [args...]
//
// Tests, e2e runs, gallery shots, benchmarks and spec checks are heavy: each
// spawns many processes. Several agents work in separate worktrees on one
// machine, so without a shared queue they all run at once and the machine stalls.
// The lock lives outside the repo, so every worktree shares it.
//
// JUNO_HEAVY_SLOTS sets how many heavy jobs may run at once (default 1).
// JUNO_HEAVY_HELD=1 is set for the child, so nested heavy commands do not wait
// on their own parent.

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
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

const root = join(tmpdir(), 'juno-heavy')
const slots = Math.max(1, Number(process.env.JUNO_HEAVY_SLOTS ?? 1))
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
const tryAcquire = () => {
  for (let index = 0; index < slots; index++) {
    const dir = join(root, `slot-${index}`)
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, label, since: new Date().toISOString() }))
      return dir
    } catch {
      // Taken. Free it if its owner died without releasing it.
      try {
        const owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'))
        if (!alive(owner.pid)) rmSync(dir, { recursive: true, force: true })
      } catch {
        // The owner is still writing its file; try again on the next poll.
      }
    }
  }
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

const release = () => rmSync(slot, { recursive: true, force: true })
process.on('exit', release)
const code = await run()
release()
process.exit(code)
