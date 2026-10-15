// Shared by every worktree on this Mac. Persist ownership before creating or
// destroying machines so a killed run or failed Namespace call can be recovered.
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capacity, machinesToDestroy } from './pool-decisions.mjs'

const dir = join(tmpdir(), 'juno-remote-pool')
const owner = createHash('sha256').update(hostname()).update(dir).digest('hex').slice(0, 16)
const idleMs = Number(process.env.JUNO_REMOTE_IDLE_MINUTES ?? 5) * 60_000
const idlePerShape = Number(process.env.JUNO_REMOTE_IDLE_PER_SHAPE ?? 2)
const maxVcpu = Number(process.env.JUNO_REMOTE_MAX_VCPU ?? 64)
const lifetimeMs = 3 * 60 * 60_000
const handOutMs = lifetimeMs - 30 * 60_000
mkdirSync(dir, { recursive: true })
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const alive = (pid) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
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
function write(state) {
  const temporary = `${statePath(state.id)}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(state))
  renameSync(temporary, statePath(state.id))
}
const entries = () => readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => read(name.slice(0, -5))).filter(Boolean)
const machines = () => entries().filter((state) => !state.pending)
function lockOwner(id) {
  try {
    return Number(readFileSync(join(lockPath(id), 'pid'), 'utf8'))
  } catch {
    return undefined
  }
}
function lock(id) {
  try {
    mkdirSync(lockPath(id))
    writeFileSync(join(lockPath(id), 'pid'), String(process.pid))
    return true
  } catch {
    return false
  }
}
const unlock = (id) => rmSync(lockPath(id), { recursive: true, force: true })
function lockIsNew(id) {
  try { return Date.now() - statSync(lockPath(id)).mtimeMs <= 30_000 } catch { return false }
}
function takeLock(id) {
  const pid = lockOwner(id)
  if (pid !== undefined && !alive(pid)) unlock(id)
  if (pid === undefined && existsSync(lockPath(id))) {
    // A process can die between mkdir and writing its PID. Allow time for a
    // live creator to finish publishing the lock before recovering it.
    if (!lockIsNew(id)) unlock(id)
  }
  return lock(id)
}
function list() {
  const result = spawnSync('nsc', ['list', '-o', 'json'], { encoding: 'utf8', timeout: 30_000 })
  if (result.status !== 0) throw new Error(`nsc list failed: ${result.error?.message ?? result.stderr.trim()}`)
  const instances = JSON.parse(result.stdout)
  if (!Array.isArray(instances)) throw new Error('nsc list did not return an array')
  return instances
}
function forget(id) {
  rmSync(statePath(id), { force: true })
  unlock(id)
}
function ensureReaper() {
  const pidFile = join(dir, 'watcher.pid')
  try { if (alive(Number(readFileSync(pidFile, 'utf8')))) return } catch { /* No watcher yet. */ }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--watch'], { detached: true, stdio: 'ignore' })
  writeFileSync(pidFile, String(child.pid))
  child.unref()
}

/** A failed destroy remains recorded and cannot be handed out again. */
export function destroy(id) {
  if (alive(lockOwner(id)) && lockOwner(id) !== process.pid) return false
  if (lockOwner(id) !== process.pid && !takeLock(id)) return false
  write({ ...read(id), id, destroying: true })
  const result = spawnSync('nsc', ['destroy', id, '--force'], { encoding: 'utf8', timeout: 30_000 })
  let gone = result.status === 0
  if (!gone) {
    try { gone = !list().some((instance) => instance.cluster_id === id) } catch { /* Retain state when the workspace cannot be read. */ }
  }
  if (gone) forget(id)
  else {
    unlock(id)
    console.error(`remote: destroy ${id} failed; retained for retry: ${result.error?.message ?? result.stderr.trim()}`)
    ensureReaper()
  }
  return gone
}

/** Keep debugging machines tracked until their Namespace lifetime ends. */
export function keep(id) {
  const state = read(id)
  if (state) write({ ...state, kept: true })
  unlock(id)
  ensureReaper()
}

function reconcile() {
  const instances = list()
  const states = machines().map((state) => {
    const pid = lockOwner(state.id)
    const publishing = pid === undefined && lockIsNew(state.id)
    return { ...state, live: alive(pid) || publishing, abandoned: existsSync(lockPath(state.id)) && !alive(pid) && !publishing }
  })
  const pending = entries().filter((entry) => entry.pending).map((entry) => ({ ...entry, live: alive(entry.pid) }))
  const targets = machinesToDestroy({ instances, states, pending, owner, now: Date.now(), idleMs, lifetimeMs })
  for (const id of targets) destroy(id)
  const present = new Set(instances.map((instance) => instance.cluster_id))
  for (const state of states) if (!present.has(state.id) && !state.live) forget(state.id)
  for (const entry of pending) if (!entry.live) rmSync(statePath(entry.id), { force: true })
  return targets.length ? list() : instances
}

export async function acquire(machine, create, log) {
  ensureReaper()
  const started = Date.now()
  let reported = false
  for (;;) {
    if (!takeLock('decide')) { await sleep(500); continue }
    try {
      const instances = reconcile()
      const all = machines()
      for (const state of all) {
        if (!state.destroying && !state.kept && state.machine === machine && Date.now() - state.created < handOutMs && takeLock(state.id)) {
          return { id: state.id, warm: true, images: state.images ?? [] }
        }
      }
      let usage = capacity(instances, all)
      let used = usage.tracked + usage.untracked
      for (const state of all) {
        if (used + vcpu(machine) <= maxVcpu) break
        if (!state.kept && !state.destroying && takeLock(state.id) && destroy(state.id)) used -= vcpu(state.machine)
      }
      if (used + vcpu(machine) <= maxVcpu) {
        const token = randomUUID()
        const pending = { id: `pending-${token}`, pending: true, token, pid: process.pid, created: Date.now(), machine }
        write(pending)
        // Do not retry creation: a timeout can mean the machine was created.
        // The attempt label lets reconciliation recover even a lost response.
        try {
          const id = await create('3h', { 'juno-pool': owner, 'juno-create': token })
          write({ id, machine, created: Date.now(), lastUsed: Date.now(), images: [] })
          lock(id)
          rmSync(statePath(pending.id), { force: true })
          return { id, warm: false, images: [] }
        } catch (error) {
          write({ ...pending, pid: undefined })
          throw error
        }
      }
      if (!reported && Date.now() - started >= 60_000) {
        usage = capacity(list(), machines())
        log(`waiting for capacity (cap ${maxVcpu} vCPU): ${usage.tracked} tracked, ${usage.untracked} untracked vCPU in the workspace`)
        reported = true
      }
    } finally { unlock('decide') }
    await sleep(10_000)
  }
}

export function release(id, image) {
  const state = read(id)
  if (!state || state.destroying) return
  const idle = machines().filter((other) => other.id !== id && !other.kept && !other.destroying && other.machine === state.machine && !existsSync(lockPath(other.id)))
  if (idle.length >= idlePerShape) { destroy(id); return }
  write({ ...state, lastUsed: Date.now(), images: [...new Set([...(state.images ?? []), image])] })
  unlock(id)
  ensureReaper()
}

/** Also accepts old per-machine reaper invocations during rollout. */
export async function reap() {
  if (!takeLock('watcher')) return
  const started = Date.now()
  try {
    for (;;) {
      await sleep(30_000)
      if (!takeLock('decide')) continue
      try {
        const instances = reconcile()
        if (entries().length === 0 && Date.now() - started > 6 * 60_000 && !instances.some((instance) => instance.labels?.['juno-remote'] === '1' && (!instance.labels['juno-pool'] || instance.labels['juno-pool'] === owner))) return
      } catch (error) { console.error(`remote: reconciliation failed: ${error.message}`) }
      finally { unlock('decide') }
    }
  } finally { unlock('watcher') }
}
export function status() {
  return machines().map((state) => ({ ...state, busy: alive(lockOwner(state.id)), idleFor: Date.now() - state.lastUsed }))
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--watch') await reap()
