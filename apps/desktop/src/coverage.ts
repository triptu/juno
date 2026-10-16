/**
 * Coverage for e2e test selection (docs/development.md, "Affected tests").
 *
 * When JUNO_E2E_COVERAGE names a directory, this process records which of its
 * functions run, through its own inspector, from the moment this module loads.
 * It is the first import of every Node entry (main, engine, agent), so it
 * starts before the rest of the bundle runs. Every two seconds, when asked and
 * when the process ends, it writes the start offsets of the functions that ran
 * since the last write to `<dir>/<process>-<pid>-<n>.json`. Main records each
 * window's renderer the same way over the DevTools protocol
 * (`recordWindowCoverage`). `scripts/coverage-map.mjs` maps the offsets back
 * to source files with the build's source maps.
 *
 * A normal launch never sets the variable, and then nothing here runs.
 */
import type { App, WebContents } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'
import { join } from 'node:path'

interface ScriptCoverage {
  readonly url: string
  readonly functions: ReadonlyArray<{ readonly ranges: ReadonlyArray<{ readonly startOffset: number; readonly count: number }> }>
}

const dir = process.env['JUNO_E2E_COVERAGE']
let writes = 0

/** Per built script, the start offsets of the functions that ran. A script's own top level starts at 0 and is left out. */
function write(kind: string, result: ReadonlyArray<ScriptCoverage>): void {
  if (dir === undefined) return
  const ran: Record<string, Array<number>> = {}
  for (const script of result) {
    if (!/\/out\/(main|preload|renderer)\/|^juno:\/\/app\//.test(script.url)) continue
    const starts = script.functions.flatMap((fn) => {
      const range = fn.ranges[0]
      return range !== undefined && range.count > 0 && range.startOffset > 0 ? [range.startOffset] : []
    })
    if (starts.length > 0) ran[script.url] = starts
  }
  if (Object.keys(ran).length === 0) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${kind}-${process.pid}-${writes++}.json`), JSON.stringify(ran))
}

/** Writes what ran in this process since the last write. Does nothing without JUNO_E2E_COVERAGE. */
export const flushCoverage: () => void = (() => {
  if (dir === undefined) return () => {}
  const session = new Session()
  session.connect()
  // An in-process session answers synchronously, so this also works in an exit handler.
  session.post('Profiler.enable')
  session.post('Profiler.startPreciseCoverage', { callCount: false, detailed: false })
  // The script URLs in each write tell the engine and the agent apart.
  const kind = process.type === 'browser' ? 'main' : 'utility'
  const flush = () => session.post('Profiler.takePreciseCoverage', (error, taken) => error === null && write(kind, taken.result))
  setInterval(flush, 2000).unref()
  process.on('exit', flush)
  // Main ends a utility process with SIGTERM, which skips exit handlers: write, then end as the signal would.
  if (process.type === 'utility') {
    process.once('SIGTERM', () => {
      flush()
      process.kill(process.pid, 'SIGTERM')
    })
  }
  return flush
})()

const windows = new Set<() => Promise<void>>()

/** Records every renderer main creates, from before its page loads. Call once in main. */
export function recordWindowCoverage(app: App): void {
  if (dir === undefined) return
  app.on('web-contents-created', (_event, contents: WebContents) => {
    try {
      contents.debugger.attach('1.3')
    } catch {
      return
    }
    void contents.debugger.sendCommand('Profiler.enable')
    void contents.debugger.sendCommand('Profiler.startPreciseCoverage', { callCount: false, detailed: false })
    const flush = async () => {
      if (contents.isDestroyed() || !contents.debugger.isAttached()) return
      const taken = (await contents.debugger.sendCommand('Profiler.takePreciseCoverage').catch(() => undefined)) as { result: Array<ScriptCoverage> } | undefined
      if (taken !== undefined) write('renderer', taken.result)
    }
    const timer = setInterval(() => void flush(), 2000)
    windows.add(flush)
    contents.once('destroyed', () => {
      clearInterval(timer)
      windows.delete(flush)
    })
  })
}

/** Writes what ran in main and every renderer since the last write. Tests call it before they close the app. */
export async function flushAllCoverage(): Promise<void> {
  flushCoverage()
  await Promise.all([...windows].map((flush) => flush()))
}
