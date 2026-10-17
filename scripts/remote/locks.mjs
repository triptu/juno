// Locks in the shared pool folder: a directory per lock holding its owner's PID.
// A lock whose owner has died can be taken over.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = join(tmpdir(), 'juno-remote-pool')
export const alive = (pid) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}
export const lockPath = (id) => join(dir, `${id}.lock`)
export function lockOwner(id) {
  try {
    return Number(readFileSync(join(lockPath(id), 'pid'), 'utf8'))
  } catch {
    return undefined
  }
}
export function lock(id) {
  try {
    mkdirSync(lockPath(id))
    writeFileSync(join(lockPath(id), 'pid'), String(process.pid))
    return true
  } catch {
    return false
  }
}
export const unlock = (id) => rmSync(lockPath(id), { recursive: true, force: true })
export function lockIsNew(id) {
  try { return Date.now() - statSync(lockPath(id)).mtimeMs <= 30_000 } catch { return false }
}
export function takeLock(id) {
  const pid = lockOwner(id)
  if (pid !== undefined && !alive(pid)) unlock(id)
  if (pid === undefined && existsSync(lockPath(id))) {
    // A process can die between mkdir and writing its PID. Allow time for a
    // live creator to finish publishing the lock before recovering it.
    if (!lockIsNew(id)) unlock(id)
  }
  return lock(id)
}
