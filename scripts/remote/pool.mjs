// The warm pool behind scripts/remote.mjs: Namespace machines that already
// pulled the image wait here between runs, so a run skips creating a machine
// and pulling (about a minute). The pool lives in the system temp folder, shared
// by every worktree on this Mac.
//
// - A machine runs one job at a time. A run claims it by creating its lock
//   directory, which only one process can do.
// - After a clean run the machine goes back to the pool. A detached reaper
//   destroys it once it has been idle for JUNO_REMOTE_IDLE_MINUTES (default 10).
//   Each machine also ends on its own after its Namespace duration (3 hours),
//   and is not handed out in its last 30 minutes.
// - Machines in use and idle together stay within JUNO_REMOTE_MAX_VCPU (default
//   64, the Team plan's Linux limit). A run waits while the pool is full.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = join(tmpdir(), 'juno-remote-pool')
const idleMs = Number(process.env.JUNO_REMOTE_IDLE_MINUTES ?? 10) * 60_000
const maxVcpu = Number(process.env.JUNO_REMOTE_MAX_VCPU ?? 64)
const lifetime = '3h'
const lifetimeMs = 3 * 60 * 60_000
const handOutMs = lifetimeMs - 30 * 60_000
mkdirSync(dir, { recursive: true })

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const vcpu = (machine) => Number(/:(\d+)x/.exec(machine)?.[1] ?? 8)
const statePath = (id) => join(dir, `${id}.json`)
const lockPath = (id) => join(dir, `${id}.lock`)

function read(id) {
  try {
    return JSON.parse(readFileSync(statePath(id), 'utf8'))
  } catch {
    return undefined
  }
}
const write = (state) => writeFileSync(statePath(state.id), JSON.stringify(state))
const machines = () => readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => read(name.slice(0, -5))).filter(Boolean)

function lock(id) {
  try {
    mkdirSync(lockPath(id))
    writeFileSync(join(lockPath(id), 'pid'), String(process.pid))
    return true
  } catch {
    return false
  }
}
function lockOwner(id) {
  try {
    return Number(readFileSync(join(lockPath(id), 'pid'), 'utf8'))
  } catch {
    return undefined
  }
}

export function destroy(id) {
  spawnSync('nsc', ['destroy', id, '--force'], { stdio: 'ignore' })
  rmSync(statePath(id), { force: true })
  rmSync(lockPath(id), { recursive: true, force: true })
}

/** Takes a machine out of the pool without destroying it (`pnpm remote --keep`). */
export function forget(id) {
  rmSync(statePath(id), { force: true })
  rmSync(lockPath(id), { recursive: true, force: true })
}

/** Destroys machines that are too old, gone, or left locked by a run that died. */
function tidy() {
  for (const state of machines()) {
    const owner = lockOwner(state.id)
    const orphaned = owner !== undefined && !alive(owner)
    if (orphaned || Date.now() - state.created > lifetimeMs) destroy(state.id)
  }
}

/**
 * A machine for one run: an idle warm one of this shape, or a new one when the
 * pool has room. `create` makes a machine and returns its id.
 */
export async function acquire(machine, create, log) {
  for (let waited = 0; ; waited++) {
    // One process at a time decides, so two runs cannot both take the last room.
    if (!lock('decide')) {
      if (!alive(lockOwner('decide') ?? 0)) rmSync(lockPath('decide'), { recursive: true, force: true })
      await sleep(500)
      waited--
      continue
    }
    try {
      const claimed = await decideOnce(machine, create)
      if (claimed) return claimed
    } finally {
      rmSync(lockPath('decide'), { recursive: true, force: true })
    }
    if (waited % 6 === 0) log(`the pool is full (JUNO_REMOTE_MAX_VCPU=${maxVcpu}); waiting for a machine`)
    await sleep(10_000)
  }
}

async function decideOnce(machine, create) {
  tidy()
  const all = machines()
  for (const state of all.filter((candidate) => candidate.machine === machine && Date.now() - candidate.created < handOutMs)) {
    if (lock(state.id)) return { id: state.id, warm: true, images: state.images ?? [] }
  }
  let used = all.reduce((sum, state) => sum + vcpu(state.machine), 0)
  // An idle machine of another shape gives way to a new one when the pool is full.
  while (used + vcpu(machine) > maxVcpu) {
    const idle = all.find((state) => state.machine !== machine && read(state.id) && lock(state.id))
    if (!idle) return undefined
    destroy(idle.id)
    used -= vcpu(idle.machine)
  }
  const id = await create(lifetime)
  write({ id, machine, created: Date.now(), lastUsed: Date.now(), images: [] })
  lock(id)
  return { id, warm: false, images: [] }
}

/** Puts a machine back after a clean run and makes sure a reaper watches it. */
export function release(id, image, reaper) {
  const state = read(id)
  if (!state) return
  write({ ...state, lastUsed: Date.now(), images: [...new Set([...(state.images ?? []), image])] })
  rmSync(lockPath(id), { recursive: true, force: true })
  const pidFile = join(dir, `${id}.reaper`)
  let running
  try {
    running = alive(Number(readFileSync(pidFile, 'utf8')))
  } catch {
    running = false
  }
  if (!running) {
    const child = spawn(process.execPath, [reaper, '--reap', id], { detached: true, stdio: 'ignore' })
    writeFileSync(pidFile, String(child.pid))
    child.unref()
  }
}

/** The reaper's loop: destroys the machine once it has been idle long enough, then exits. */
export async function reap(id) {
  for (;;) {
    await sleep(30_000)
    const state = read(id)
    if (!state) break
    if (lockOwner(id) !== undefined) continue
    if (Date.now() - state.lastUsed >= idleMs || Date.now() - state.created > lifetimeMs) {
      // Take the lock so no run claims it while it goes.
      if (lock(id)) destroy(id)
      break
    }
  }
  rmSync(join(dir, `${id}.reaper`), { force: true })
}

/** Every machine in the pool, for `pnpm remote --status`. */
export function status() {
  return machines().map((state) => ({ ...state, busy: lockOwner(state.id) !== undefined, idleFor: Date.now() - state.lastUsed }))
}
