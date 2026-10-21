/** Buffered process logs. Only catalog events and checked diagnostic fields reach disk. */
import { appendFile, mkdir, rename, stat, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Logger } from 'effect'
import { isSchemaPath } from '@juno/slack'
import { LOG_EVENTS } from './logEvents'

export const LOG_LIMIT = 5 * 1024 * 1024
export const LOG_PROCESSES = ['main', 'engine', 'agent'] as const
export type LogProcess = typeof LOG_PROCESSES[number]
export type Level = 'INFO' | 'WARN' | 'ERROR'
const FIELDS = new Set(['id', 'rowId', 'pid', 'count', 'attempts', 'retryInMillis', 'cpu', 'memoryMb', 'passes', 'offset'])
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AggregateError', 'ReferenceError'])
const SLACK_ERRORS = new Set(['SlackTransportError', 'SlackDecodeError', 'SlackRejected', 'SlackAuthRequired', 'SlackRateLimited'])

export function logFolder(): string {
  return process.env.JUNO_E2E === '1' && process.env.JUNO_USER_DATA
    ? join(process.env.JUNO_USER_DATA, 'logs')
    : join(homedir(), 'Library', 'Logs', 'Juno')
}

/** Deliberately drops error messages, paths, arbitrary tags, unchecked strings and object payloads. */
export function safeDetails(value: unknown, depth = 0, seen = new Set<unknown>()): string {
  if (depth > 5 || value === null || typeof value !== 'object' || seen.has(value)) return ''
  seen.add(value)
  const parts: string[] = []
  if ('_tag' in value) {
    const tag: unknown = Reflect.get(value, '_tag')
    if (typeof tag === 'string' && ['Fail', 'Die', 'Interrupt', 'SqlError', 'SlackTransportError', 'SlackDecodeError', 'SlackRejected', 'SlackAuthRequired', 'SlackRateLimited', 'SchemaError', 'Offline', 'Rejected', 'RateLimited', 'NotSignedIn'].includes(tag)) parts.push(`cause=${tag}`)
    if (typeof tag === 'string' && SLACK_ERRORS.has(tag)) {
      const method: unknown = Reflect.get(value, 'method')
      if (typeof method === 'string' && method.length <= 80 && method.trim() === method && /^[a-z]+(?:\.[a-zA-Z]+)+$/.test(method)) parts.push(`method=${method}`)
      if (tag === 'SlackDecodeError') {
        const path: unknown = Reflect.get(value, 'schemaPath')
        const kind: unknown = Reflect.get(value, 'issueKind')
        if (isSchemaPath(path)) parts.push(`schemaPath=${path}`)
        if (kind === 'missing' || kind === 'wrong_type' || kind === 'invalid') parts.push(`issueKind=${kind}`)
      }
      if (tag === 'SlackRejected') {
        const code: unknown = Reflect.get(value, 'error')
        if (typeof code === 'string' && code.trim() === code && /^[a-z_]{1,64}$/.test(code)) parts.push(`code=${code}`)
      }
    }
  }
  if (value instanceof Error) {
    parts.push(`cause=${ERROR_NAMES.has(value.name) ? value.name : 'Error'}`)
    // Stack locations without file names, function names, paths or the error's first line.
    const frames = (value.stack ?? '').split('\n').slice(1).flatMap((line) => {
      const match = /^\s+at .+:(\d+):(\d+)\)?$/.exec(line)
      return match ? [`${match[1]}:${match[2]}`] : []
    }).slice(0, 12)
    if (frames.length) parts.push(`stack=${frames.join(',')}`)
  }
  for (const [key, allowed] of Object.entries({ reason: ['read_error', 'not_signed_in', 'bad_chunk', 'file_too_large', 'connection_error', 'engine_error'], step: ['requestSecrets', 'signIn', 'importFromSlackApp', 'storeSecrets', 'signOut', 'authRequired'], worker: ['post', 'action', 'mark'], process: ['Main', 'Window', 'Engine', 'Juno agent', 'Graphics', 'Network', 'Other'], view: ['starting', 'topic', 'Home', 'All topics', 'Settings', 'Juno', 'no tab'] })) {
    if (key in value) {
      const field: unknown = Reflect.get(value, key)
      if (typeof field === 'string' && allowed.includes(field)) parts.push(`${key}=${field}`)
    }
  }
  for (const key of FIELDS) {
    if (!(key in value)) continue
    const field: unknown = Reflect.get(value, key)
    if (typeof field === 'number' && Number.isFinite(field)) parts.push(`${key}=${field}`)
    else if ((key === 'id' || key === 'rowId') && typeof field === 'string' && field.length <= 80 && /^(?:[CDGUT][A-Z0-9]{8,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9]+(?:\.[0-9]+)?)$/.test(field)) parts.push(`${key}=${field}`)
  }
  // Effect Cause and nested native errors. Never serialize or stringify arbitrary data.
  for (const key of ['cause', 'error', 'defect', 'reasons']) {
    if (!(key in value)) continue
    const next: unknown = Reflect.get(value, key)
    for (const item of Array.isArray(next) ? next.slice(0, 8) : [next]) {
      const detail = safeDetails(item, depth + 1, seen)
      if (detail) parts.push(detail)
    }
  }
  return parts.join(' ')
}

export function createLog(processName: LogProcess, folder = logFolder()) {
  const file = join(folder, `${processName}.log`)
  let size = 0
  let queued: string[] = []
  let bytes = 0
  let dropped = 0
  let failed = false
  let writing: Promise<void> = mkdir(folder, { recursive: true }).then(async () => {
    await appendFile(file, '', { mode: 0o600 })
    size = (await stat(file)).size
  }).catch(() => { failed = true })
  let draining: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (draining) return draining.then(() => flush())
    if (queued.length === 0 && dropped === 0) return writing
    const lines = queued
    if (dropped) lines.push(`${new Date().toISOString()} WARN ${processName} log buffer overflow count=${dropped}\n`)
    queued = []; bytes = 0; dropped = 0
    draining = writing.then(async () => {
      if (failed) return
      let batch = ''
      for (const line of lines) {
        const length = Buffer.byteLength(line)
        if (size + length > LOG_LIMIT) {
          if (batch) { await appendFile(file, batch, { mode: 0o600 }); batch = '' }
          for (let n = 3; n >= 1; n--) {
            await rename(n === 1 ? file : `${file}.${n - 1}`, `${file}.${n}`).catch((error: unknown) => {
              if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
            })
          }
          size = 0
        }
        batch += line
        size += length
      }
      if (batch) await appendFile(file, batch, { mode: 0o600 })
    }).catch(() => { failed = true }).finally(() => { draining = undefined })
    writing = draining
    return draining.then(() => queued.length || dropped ? flush() : undefined)
  }
  const log = (level: Level, event: unknown, details?: unknown): void => {
    const label = typeof event === 'string' && LOG_EVENTS.has(event) ? event : 'diagnostics unavailable'
    let extra = ''
    try { extra = safeDetails(details) } catch { /* An error's getter must never break its caller. */ }
    const line = `${new Date().toISOString()} ${level} ${processName} ${label}${extra ? ` ${extra}` : ''}\n`
    if (bytes + Buffer.byteLength(line) > 256 * 1024) { dropped++; return }
    queued.push(line); bytes += Buffer.byteLength(line)
    // An empty buffer has no work due and needs no periodic wake.
    if (timer === undefined) {
      timer = setTimeout(() => { void flush() }, 250)
      timer.unref()
    }
  }
  const effectLogger = Logger.make<unknown, void>((options) => {
    if (options.logLevel !== 'Warn' && options.logLevel !== 'Error' && options.logLevel !== 'Fatal') return
    const messages = Array.isArray(options.message) ? options.message : [options.message]
    log(options.logLevel === 'Warn' ? 'WARN' : 'ERROR', messages[0], { cause: options.cause, error: messages[0], defect: messages[1] })
  })
  log('INFO', 'process started', { pid: process.pid })
  return { log, effectLogger, flush, close: async () => { await flush() }, healthy: () => !failed }
}

/** Scans backwards in small chunks so Copy does not load whole log files into main. Keeps the last `limit` lines that pass `keep`. */
async function readLastLines(file: string, limit: number, keep: (line: string) => boolean): Promise<string[]> {
  const handle = await open(file, 'r').catch(() => undefined)
  if (!handle) return []
  try {
    let end = (await handle.stat()).size
    let carry = ''
    const found: string[] = []
    while (end > 0 && found.length < limit) {
      const length = Math.min(end, 64 * 1024)
      end -= length
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, end)
      const lines = (buffer.toString('utf8', 0, bytesRead) + carry).split('\n')
      carry = end > 0 ? lines.shift() ?? '' : ''
      // Generated lines are bounded. Ignore a malformed, unbounded line in an old file.
      if (carry.length > 16 * 1024) carry = ''
      for (const line of lines.toReversed()) {
        if (keep(line)) found.push(line)
        if (found.length === limit) break
      }
    }
    return found.toReversed()
  } finally { await handle.close() }
}

/** Includes rotations so a fresh file does not hide warnings. */
export async function warningLines(folder = logFolder()): Promise<Array<{ process: LogProcess; lines: string[] }>> {
  const results: Array<{ process: LogProcess; lines: string[] }> = []
  for (const process of LOG_PROCESSES) {
    const lines: string[] = []
    for (let n = 0; n <= 3 && lines.length < 50; n++) {
      lines.unshift(...await readLastLines(join(folder, `${process}.log${n ? `.${n}` : ''}`), 50 - lines.length, (line) => /^\S+ (WARN|ERROR) (main|engine|agent) /.test(line)).catch(() => []))
    }
    results.push({ process, lines })
  }
  return results
}

/** The last `limit` lines of one process's log, every level, with its rotations when the file is short. Only lines the writer made are kept. */
export async function lastLines(process: LogProcess, limit: number, folder = logFolder()): Promise<string[]> {
  const lines: string[] = []
  const written = new RegExp(`^\\S+ (INFO|WARN|ERROR) ${process} `)
  for (let n = 0; n <= 3 && lines.length < limit; n++) {
    lines.unshift(...await readLastLines(join(folder, `${process}.log${n ? `.${n}` : ''}`), limit - lines.length, (line) => written.test(line)).catch(() => []))
  }
  return lines
}
