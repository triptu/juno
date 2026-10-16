// Shared by every worktree on this Mac. Persist ownership before creating or
// destroying machines so a killed run or failed Namespace call can be recovered.
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capacity, machinesToDestroy, mayPass, pendingVcpu, orphanGraceMs } from './pool-decisions.mjs'

const dir = join(tmpdir(), 'juno-remote-pool')
const owner = createHash('sha256').update(hostname()).update(dir).digest('hex').slice(0, 16)
// Warm machines between runs: docs/development.md, "Current cost controls".
const defaultIdleMinutes = 8
export const idleMinutes = Number(process.env.JUNO_REMOTE_IDLE_MINUTES ?? defaultIdleMinutes)
const idleMs = idleMinutes * 60_000
const idlePerShape = Number(process.env.JUNO_REMOTE_IDLE_PER_SHAPE ?? 2)
const holdMs = Number(process.env.JUNO_REMOTE_HOLD_SECONDS ?? 120) * 1000
const maxVcpu = Math.min(24, Number(process.env.JUNO_REMOTE_MAX_VCPU ?? 24))
const lifetimeMs = 3 * 60 * 60_000
const handOutMs = lifetimeMs - 30 * 60_000
mkdirSync(dir, { recursive: true })
const transient = (error) => /ETIMEDOUT|context deadline exceeded|DeadlineExceeded|Unavailable|i\/o timeout|connection reset|connection refused/i.test(error.message)
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
const inventoryPath = join(dir, 'inventory-cache')
const revisionPath = join(dir, 'inventory-revision')
const inventoryRevision = () => {
  try { return readFileSync(revisionPath, 'utf8') } catch { return '' }
}
export function invalidateInventory() {
  const temporary = `${revisionPath}.${process.pid}.tmp`
  writeFileSync(temporary, randomUUID())
  renameSync(temporary, revisionPath)
  rmSync(inventoryPath, { force: true })
}

let daemonInventory
export function list() {
  if (daemonInventory) return daemonInventory
  try {
    const cached = JSON.parse(readFileSync(inventoryPath, 'utf8'))
    const age = Date.now() - cached.completedAt
    if (Array.isArray(cached.instances) && age >= 0 && age < 5000 && cached.revision === inventoryRevision()) return cached
  } catch { /* A missing or incomplete cache requires a fresh inventory. */ }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const startedAt = Date.now()
    const revision = inventoryRevision()
    const result = spawnSync('nsc', ['list', '-o', 'json'], { encoding: 'utf8', timeout: 90_000 })
    if (result.status !== 0) {
      const error = new Error(`nsc list failed: ${result.error?.message ?? result.stderr.trim()}`)
      if (attempt < 3 && transient(error)) continue
      throw error
    }
    // nsc prints null when no instance exists.
    const instances = JSON.parse(result.stdout) ?? []
    if (!Array.isArray(instances)) throw new Error('nsc list did not return an array')
    const snapshot = { instances, startedAt, completedAt: Date.now(), revision }
    // A mutation during this call must not publish an inventory for later readers.
    if (revision === inventoryRevision()) {
      const temporary = `${inventoryPath}.${process.pid}.tmp`
      writeFileSync(temporary, JSON.stringify(snapshot))
      renameSync(temporary, inventoryPath)
    }
    return snapshot
  }
}
function forget(id) {
  rmSync(statePath(id), { force: true })
  unlock(id)
}
export function ensureReaper() {
  if (!takeLock('watcher-start')) return
  try {
    const pidFile = join(dir, 'watcher.pid')
    const versionFile = join(dir, 'watcher.version')
    let pid
    try { pid = Number(readFileSync(pidFile, 'utf8')) } catch { /* No watcher yet. */ }
    const version = existsSync(versionFile) ? Number(readFileSync(versionFile, 'utf8')) : 1
    if (alive(pid) && version >= 10) return
    // Upgrade housekeeping only. Machine/job owners are untouched.
    if (alive(pid)) {
      const command = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', timeout: 1000 }).stdout ?? ''
      if (!/\/scripts\/remote\/pool\.mjs --watch\s*$/.test(command)) return
      try { process.kill(pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--watch'], { detached: true, stdio: 'ignore', env: { ...process.env, JUNO_REMOTE_IDLE_MINUTES: String(defaultIdleMinutes) } })
    child.on('error', () => { /* Clients fall back when the daemon cannot start. */ })
    writeFileSync(pidFile, String(child.pid))
    writeFileSync(versionFile, '10')
    child.unref()
  } finally { unlock('watcher-start') }
}

/** A failed destroy remains recorded and cannot be handed out again. */
export function destroy(id) {
  if (alive(lockOwner(id)) && lockOwner(id) !== process.pid) return false
  if (lockOwner(id) !== process.pid && !takeLock(id)) return false
  write({ ...read(id), id, destroying: true })
  invalidateInventory()
  const result = spawnSync('nsc', ['destroy', id, '--force'], { encoding: 'utf8', timeout: 30_000 })
  invalidateInventory()
  let gone = result.status === 0
  if (!gone && !daemonAlive()) {
    try { gone = !list().instances.some((instance) => instance.cluster_id === id) } catch { /* Retain state when the workspace cannot be read. */ }
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

function machineStates() {
  return machines().map((state) => {
    const pid = lockOwner(state.id)
    const publishing = pid === undefined && lockIsNew(state.id)
    return { ...state, live: alive(pid) || publishing, abandoned: existsSync(lockPath(state.id)) && !alive(pid) && !publishing }
  })
}

/** The decision lock is held; an unavailable inventory must not retain known idle machines. */
function reapIdle() {
  // Failed creates need the inventory labels to clear their pending reservation.
  const states = machineStates().filter((state) => !state.destroying)
  const targets = machinesToDestroy({ instances: [], states, pending: [], owner, now: Date.now(), idleMs, lifetimeMs })
  for (const id of targets) destroy(id)
}

function reconcile() {
  reapIdle()
  const snapshot = list()
  const { instances } = snapshot
  const states = machineStates()
  const pending = entries().filter((entry) => entry.pending).map((entry) => ({ ...entry, live: alive(entry.pid) }))
  const targets = machinesToDestroy({ instances, states, pending, owner, now: Date.now(), idleMs, lifetimeMs })
  for (const id of targets) destroy(id)
  const remainingSnapshot = targets.length ? list() : snapshot
  const remaining = remainingSnapshot.instances
  const present = new Set(remaining.map((instance) => instance.cluster_id))
  for (const state of states) if (!present.has(state.id) && !state.live && state.created < remainingSnapshot.startedAt) forget(state.id)
  for (const entry of pending) if (!entry.live) {
    const observed = instances.some((instance) => instance.labels?.['juno-create'] === entry.token)
    const gone = !remaining.some((instance) => instance.labels?.['juno-create'] === entry.token)
    if (!entry.failed || (observed && gone) || Date.now() - entry.created >= orphanGraceMs) rmSync(statePath(entry.id), { force: true })
  }
  return remaining
}

async function provision(machine, pending, create) {
  invalidateInventory()
  try {
    const id = await create('3h', { 'juno-pool': owner, 'juno-create': pending.token })
    // Admission must never observe neither the pending reservation nor its machine.
    while (!takeLock('decide')) await sleep(100)
    try {
      lock(id)
      write({ id, machine, created: Date.now(), lastUsed: Date.now(), images: [] })
      rmSync(statePath(pending.id), { force: true })
    } finally { unlock('decide') }
    return { id, warm: false, images: [] }
  } catch (error) {
    write({ ...pending, pid: undefined, failed: true })
    if (error.instanceId && destroy(error.instanceId)) rmSync(statePath(pending.id), { force: true })
    throw error
  } finally { invalidateInventory() }
}

const queueDir = join(dir, 'queue')
mkdirSync(queueDir, { recursive: true })
const requestPath = (id) => join(queueDir, id)
function readRequest(id) {
  try { return JSON.parse(readFileSync(requestPath(id), 'utf8')) } catch { return undefined }
}
function writeRequest(request) {
  const temporary = `${requestPath(request.id)}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(request))
  renameSync(temporary, requestPath(request.id))
}
function queue() {
  return readdirSync(queueDir).filter((id) => !id.endsWith('.tmp')).map(readRequest).filter((request) => {
    if (!request) return false
    if (alive(request.pid)) return true
    rmSync(requestPath(request.id), { force: true })
    return false
  }).toSorted((a, b) => a.order - b.order)
}
function daemonAlive() {
  try {
    return Number(readFileSync(join(dir, 'watcher.version'), 'utf8')) >= 10 && alive(Number(readFileSync(join(dir, 'watcher.pid'), 'utf8')))
  } catch { return false }
}

// Called under decide by either the daemon or a surviving client. Reservations
// name the request so a crash before publishing its answer cannot allocate twice.
function admit(request, instances) {
  const pendingId = `pending-${request.id}`
  const existing = read(pendingId)
  if (existing) return { pending: existing }
  const all = machines()
  const claimed = all.find((state) => state.requestId === request.id && lockOwner(state.id) === request.pid)
  if (claimed) return { id: claimed.id, warm: true, images: claimed.images ?? [] }
  for (const state of all) {
    if (!request.fresh && state.machine === request.machine && takeLock(state.id)) {
      const current = read(state.id)
      if (current && !current.destroying && !current.kept && Date.now() - current.created < handOutMs) {
        write({ ...current, requestId: request.id })
        writeFileSync(join(lockPath(state.id), 'pid'), String(request.pid))
        return { id: current.id, warm: true, images: current.images ?? [] }
      }
      unlock(state.id)
    }
  }
  const usage = capacity(instances, all)
  let used = usage.tracked + usage.untracked + pendingVcpu(instances, entries().filter((entry) => entry.pending))
  const cap = Math.min(24, request.cap)
  for (const state of all) {
    if (used + vcpu(request.machine) <= cap) break
    if (!state.kept && !state.destroying && takeLock(state.id) && destroy(state.id)) used -= vcpu(state.machine)
  }
  if (used + vcpu(request.machine) > cap) return
  const pending = { id: pendingId, pending: true, token: request.id, pid: request.pid, created: Date.now(), machine: request.machine }
  write(pending)
  return { pending }
}
// A request that does not fit leaves free cores to later requests that fit,
// until it has waited JUNO_REMOTE_HOLD_SECONDS (default 120); then it holds
// them so it is not starved.
function dispatch(instances) {
  const blocked = []
  for (const request of queue()) {
    if (request.result || request.error) continue
    if (!mayPass(blocked, Date.now(), holdMs)) break
    const result = admit(request, instances)
    if (result) writeRequest({ ...request, result })
    else blocked.push(request)
  }
}
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`

export async function acquire(machine, create, log, { fresh = false } = {}) {
  if (!Number.isFinite(maxVcpu) || maxVcpu < 0) throw new Error('JUNO_REMOTE_MAX_VCPU must be non-negative')
  if (maxVcpu === 0) throw new Error('Namespace is disabled (JUNO_REMOTE_MAX_VCPU=0)')
  if (vcpu(machine) > maxVcpu) throw new Error(`machine needs ${vcpu(machine)} vCPU, above cap ${maxVcpu}`)
  ensureReaper()
  let createFailures = 0
  const started = Date.now()
  for (;;) {
    while (!takeLock('decide')) await sleep(100)
    const request = { id: randomUUID(), pid: process.pid, machine, fresh, cap: maxVcpu, created: started }
    try {
      request.order = Math.max(Date.now(), ...queue().map((item) => item.order + 1))
      writeRequest(request)
    } finally { unlock('decide') }
    let reportedAt = 0
    let fallbackReported = false
    try {
      for (;;) {
        if (!daemonAlive() && takeLock('decide')) {
          try {
            if (!fallbackReported) { log('pool daemon unavailable; using direct admission'); fallbackReported = true }
            dispatch(reconcile())
          } catch (error) {
            if (!error.message.startsWith('nsc list failed:') || !transient(error)) throw error
            log(`infrastructure: inventory unavailable, retrying (${error.message.split('\n')[0]})`)
            await sleep(2000)
          } finally { unlock('decide') }
        }
        const current = readRequest(request.id)
        if (current?.error) throw new Error(current.error)
        if (current?.result) {
          // The persisted reservation/lock is already owned by this client.
          rmSync(requestPath(request.id), { force: true })
          if (!current.result.pending) return current.result
          return await provision(machine, current.result.pending, create)
        }
        if (Date.now() - reportedAt >= 10_000) {
          const position = queue().filter((item) => !item.result && !item.error).findIndex((item) => item.id === request.id) + 1
          if (position > 0) log(`waiting: ${ordinal(position)} in queue, ${vcpu(machine)} cores, ${Math.floor((Date.now() - started) / 1000)} s elapsed`)
          reportedAt = Date.now()
        }
        await sleep(500)
      }
    } catch (error) {
      if (!transient(error) || ++createFailures > 2) throw error
      log(`infrastructure: create timed out; reclaiming attempt and retrying (${createFailures}/2)`)
      await sleep(createFailures * 2000)
    } finally { rmSync(requestPath(request.id), { force: true }) }
  }
}

export function release(id, image) {
  const state = read(id)
  if (!state || state.destroying) return
  if (!takeLock('decide')) { destroy(id); return }
  try {
  const idle = machines().filter((other) => other.id !== id && !other.kept && !other.destroying && other.machine === state.machine && !existsSync(lockPath(other.id)))
  if (idleMs === 0 || idle.length >= idlePerShape) { destroy(id); return }
  write({ ...state, lastUsed: Date.now(), idleMs, images: [...new Set([...(state.images ?? []), image])] })
  unlock(id)
  ensureReaper()
  } finally { unlock('decide') }
}

/** Also accepts old per-machine reaper invocations during rollout. */
export async function reap() {
  let owned = false
  for (let attempt = 0; attempt < 20 && !owned; attempt++) {
    owned = takeLock('watcher')
    if (!owned) await sleep(100)
  }
  if (!owned) return
  const started = Date.now()
  try {
    for (;;) {
      await sleep(5000)
      if (!takeLock('decide')) continue
      try {
        // One inventory read per tick, even when mutations invalidate the disk cache.
        // Local machine records and pending attempts reserve newer allocations.
        reapIdle()
        daemonInventory = list()
        const instances = reconcile()
        dispatch(instances)
        if (queue().length === 0 && entries().length === 0 && Date.now() - started > 6 * 60_000 && !instances.some((instance) => instance.labels?.['juno-remote'] === '1' && (!instance.labels['juno-pool'] || instance.labels['juno-pool'] === owner))) return
      } catch (error) {
        console.error(`remote: reconciliation failed: ${error.message}`)
        if (!transient(error)) for (const request of queue()) {
          if (!request.result) writeRequest({ ...request, error: error.message })
        }
      } finally { daemonInventory = undefined; unlock('decide') }
    }
  } finally { unlock('watcher') }
}
export function status() {
  return machines().map((state) => ({ ...state, busy: alive(lockOwner(state.id)), idleFor: Date.now() - state.lastUsed }))
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--watch') await reap()
