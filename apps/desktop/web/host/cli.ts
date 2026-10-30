// Runs on Node: Bun's node:sqlite on macOS cannot open the store (docs/development.md, "Runtimes").
/**
 * `bun run web [--host] [--demo]`: starts the web shell (`shell.ts`) on this
 * worktree's port (`port.ts`, or JUNO_WEB_PORT) and prints one line with the
 * app's and the fake Slack's control addresses. `--host` listens on every
 * interface, for a phone or another machine on the LAN; the fake Slack stays
 * on this Mac. `--demo` seeds the invented company for screenshots
 * (`demoSeed` in `@juno/fake-slack`) in place of the test seed.
 *
 * Stops on Ctrl-C, SIGTERM or SIGHUP, and when the process that started it
 * goes away, so an agent's shell that dies leaves nothing running.
 *
 * The root `web` script caps V8's old space. Without the cap V8 keeps the
 * heap it grew while Vite transformed the renderer, about twice what stays
 * live after the first load (decision log, 10-22).
 */
import { execFileSync } from 'node:child_process'
import { startWebShell } from './shell'
import { webShellPort } from './port'

const lan = process.argv.includes('--host')
const demo = process.argv.includes('--demo')
const port = webShellPort()

let stopping = false
const stop = (code: number) => {
  if (stopping) return
  stopping = true
  // Stopping takes well under a second; one that hangs must not leave the process behind.
  setTimeout(() => process.exit(code), 5000).unref()
  void starting.then((shell) => shell.stop()).finally(() => process.exit(code))
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
process.on('SIGHUP', () => stop(0))
// The processes that started us: the parent, and Bun too when the parent is the `sh -c` Bun runs
// scripts in, since that shell outlives a Bun killed without a signal. When one goes, so do we.
const ps = (field: 'ppid' | 'comm', pid: number) => execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim()
const starters = [process.ppid]
try {
  if (/(^|\/)sh$/.test(ps('comm', process.ppid))) starters.push(Number(ps('ppid', process.ppid)))
} catch {
  // No ps: the parent alone.
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
setInterval(() => {
  if (process.ppid !== starters[0] || !starters.every(alive)) stop(0)
}, 1000).unref()

const starting = startWebShell({ port, host: lan ? '0.0.0.0' : '127.0.0.1', demo })
let shell: Awaited<ReturnType<typeof startWebShell>>
try {
  shell = await starting
} catch (cause) {
  const inUse = cause instanceof Error && /port .* is already in use|EADDRINUSE/i.test(cause.message)
  console.error(inUse ? `web shell: port ${port} is in use. Is bun run web already running in this worktree? Stop it, or set JUNO_WEB_PORT.` : cause)
  process.exit(1)
}

if (stopping) await new Promise(() => {})

console.log(`Juno web shell: ${shell.url}  control: ${shell.controlUrl}/<name>  (ready in ${Math.round(process.uptime() * 1000)} ms, pid ${process.pid})`)
