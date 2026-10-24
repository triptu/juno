import { execFile } from 'node:child_process'
import { availableParallelism, loadavg } from 'node:os'

/** Each tool's time limit on an idle machine. */
const BASE_LIMIT_MS = 20_000
const MAX_LIMIT_MS = 120_000

/** The limit grows with the load: on 8 cores at a load of 16, a tool gets twice as long. */
export function timeLimit(base = BASE_LIMIT_MS, load = loadavg()[0], cores = availableParallelism()) {
  return Math.min(MAX_LIMIT_MS, Math.round(base * Math.max(1, load / cores)))
}

/** A tool that ran out of time. It says nothing about the code. */
export class ToolTimeout extends Error {
  timedOut = true
}

function once(file, args, options, limit) {
  return new Promise((accept, reject) => {
    const child = execFile(file, args, {
      ...options, encoding: 'utf8', timeout: limit, maxBuffer: 16 * 1024 * 1024,
      detached: process.platform !== 'win32',
    }, (error, stdout, stderr) => {
      if (!error) return accept(stdout)
      // jscpd starts a native child; stop the whole group on failure or timeout.
      if (child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already exited. */ }
      }
      error.timedOut = error.killed === true && error.signal === 'SIGTERM'
      error.stderr = stderr.trim()
      reject(error)
    })
  })
}

/**
 * Runs a tool with a limit scaled to the load. A timeout is retried once with a fresh limit, twice as
 * long; a second timeout rejects with `ToolTimeout`. Any other failure rejects at once.
 */
export async function runTool(name, file, args, options = {}, base = BASE_LIMIT_MS) {
  const limits = []
  for (const factor of [1, 2]) {
    const limit = timeLimit(base * factor)
    limits.push(limit)
    try { return await once(file, args, options, limit) } catch (error) {
      if (!error.timedOut) throw new Error(`${name}: ${error.message} ${error.stderr ?? ''}`.trim(), { cause: error })
    }
  }
  const load = loadavg()[0].toFixed(1)
  throw new ToolTimeout(`${name} timed out after ${limits.map((ms) => `${(ms / 1000).toFixed(0)} s`).join(' and ')} (load ${load} on ${availableParallelism()} cores). This is not a finding; run it again on a quieter machine.`)
}
