// Failing Namespace calls, recorded in the pool folder by every process so
// waiting runs can say why they wait: docs/development.md, "Remote runs", "Outages".
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activeOutage, describeOutage, noteCall, outageAfterMs, outageRemindMs, parseDuration } from './pool-decisions.mjs'

// Not a .json file: those are machine and reservation records.
const path = join(tmpdir(), 'juno-remote-pool', 'namespace-outage')
const after = parseDuration(process.env.JUNO_REMOTE_OUTAGE_AFTER) ?? outageAfterMs
const read = () => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}

/** The calls that have kept failing, or undefined when Namespace looks reachable. */
export const outage = () => activeOutage(read(), Date.now(), after)

export function noteNamespace(call, ok, error) {
  const current = read()
  if (ok && !current?.calls?.[call]) return
  const next = noteCall(current, { call, ok, error, now: Date.now() })
  if (!next) { rmSync(path, { force: true }); return }
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(next))
  renameSync(temporary, path)
}

const minutes = (ms) => ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`

/**
 * A check for a waiting run: it says once, then every few minutes, why nothing
 * is admitted, and returns true while Namespace is unreachable. It throws an
 * error with `outage` set once JUNO_REMOTE_OUTAGE_WAIT has passed.
 */
export function outageWatcher(log, started) {
  const wait = parseDuration(process.env.JUNO_REMOTE_OUTAGE_WAIT)
  let toldAt = 0
  return () => {
    const active = outage()
    if (!active) {
      if (toldAt) log('Namespace answers again; waiting for a machine')
      toldAt = 0
      return false
    }
    const text = describeOutage(active)
    if (wait !== undefined && Date.now() - active.since >= wait) {
      const error = new Error(`${text}. Gave up after ${minutes(Date.now() - active.since)} of outage (JUNO_REMOTE_OUTAGE_WAIT=${process.env.JUNO_REMOTE_OUTAGE_WAIT}); use --local to run on this Mac.`)
      error.outage = true
      throw error
    }
    if (!toldAt) log(`${text}. Waiting${wait === undefined ? '' : ` until ${minutes(wait)} of outage`}; use --local to run on this Mac.`)
    else if (Date.now() - toldAt >= outageRemindMs) log(`still waiting, ${Math.floor((Date.now() - started) / 60_000)} min so far: ${text}`)
    else return true
    toldAt = Date.now()
    return true
  }
}
