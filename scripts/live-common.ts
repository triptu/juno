/**
 * Shared by the live scripts (`smoke-live.ts`, `sync-live-dry-run.ts`):
 * the cached session in the login keychain, and decode issues reported as
 * paths, never values.
 *
 * The session cache is a generic password named `juno-dev-slack-session`,
 * written with `security add-generic-password` (its value is passed on
 * stdin, never in argv). `security` created it, so `security
 * find-generic-password` reads it back without a prompt.
 */
import { execFile } from 'node:child_process'
import { Effect, Exit, Schema } from 'effect'
import type { SchemaIssue } from 'effect'
import type { SlackSessionShape } from '@juno/slack'

export const SESSION_SERVICE = 'juno-dev-slack-session'

export interface CachedSession {
  readonly session: SlackSessionShape
  /** The `Cookie` header value, `d=...`. */
  readonly cookie: string
}

export function security(args: ReadonlyArray<string>, stdin?: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolvePromise) => {
    const child = execFile('/usr/bin/security', [...args], { timeout: 120_000 }, (error, stdout) => {
      resolvePromise({ code: error === null ? 0 : ((error as { code?: unknown }).code as number | undefined) ?? 1, stdout })
    })
    if (stdin !== undefined) child.stdin?.end(stdin)
  })
}

/** The cached session for `teamId` (or the only one), or undefined when there is none. */
export async function readCachedSession(teamId?: string): Promise<CachedSession | undefined> {
  const answer = await security(['find-generic-password', '-w', '-s', SESSION_SERVICE, ...(teamId === undefined ? [] : ['-a', teamId])])
  if (answer.code !== 0) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(answer.stdout.trim(), 'base64').toString('utf8')) as CachedSession
    if (typeof parsed.cookie !== 'string' || typeof parsed.session?.token !== 'string') return undefined
    return parsed
  } catch {
    return undefined
  }
}

/** `add-generic-password -U` replaces an item with the same service and account. The value goes in on stdin via `security -i`. */
export async function storeCachedSession(cached: CachedSession): Promise<void> {
  const value = Buffer.from(JSON.stringify(cached), 'utf8').toString('base64')
  const answer = await security(['-i'], `add-generic-password -U -s ${SESSION_SERVICE} -a ${cached.session.teamId} -w ${value}\n`)
  if (answer.code !== 0) throw new Error('could not write the session to the keychain')
}

export async function forgetCachedSession(): Promise<boolean> {
  const answer = await security(['delete-generic-password', '-s', SESSION_SERVICE])
  return answer.code === 0
}

// Decode issues as paths, never values.

export function decodeIssues(schema: Schema.Codec<unknown, unknown>, text: string): Array<string> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return ['(not JSON)']
  }
  const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(schema)(json))
  if (Exit.isSuccess(exit)) return []
  const error = Exit.isFailure(exit) ? (exit.cause as { failures?: ReadonlyArray<{ error?: unknown }> }) : undefined
  const failure = findSchemaError(error)
  return failure === undefined ? ['(decode failed, no issue tree)'] : issuePaths(failure.issue, [])
}

function findSchemaError(cause: unknown): { issue: SchemaIssue.Issue } | undefined {
  const stack: Array<unknown> = [cause]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === null || typeof current !== 'object') continue
    if ('issue' in current && current.issue !== null && typeof current.issue === 'object' && '_tag' in (current.issue as object)) {
      return current as { issue: SchemaIssue.Issue }
    }
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (value !== null && typeof value === 'object') stack.push(value)
    }
  }
  return undefined
}

function issuePaths(issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey>): Array<string> {
  switch (issue._tag) {
    case 'Pointer':
      return issuePaths(issue.issue, [...path, ...issue.path])
    case 'Composite':
      return issue.issues.flatMap((child) => issuePaths(child, path))
    case 'AnyOf':
      // A union: report the deepest problems of the longest-matching member only, to keep the list short.
      return issue.issues.length === 0 ? [`${format(path)}: no union member matched`] : issuePaths(issue.issues[0]!, path)
    case 'Filter':
    case 'Encoding':
      return issuePaths(issue.issue, path)
    default:
      return [`${format(path)}: ${issue._tag}`]
  }
}

/** Array indexes become `[]`, so the same problem in every item of a list is one path. */
const format = (path: ReadonlyArray<PropertyKey>) =>
  path.length === 0 ? '(root)' : path.map((part) => (typeof part === 'number' ? '[]' : String(part))).join('.')

// Redaction: the shape survives, the values do not.

const KEEP_KEYS = new Set(['ok', 'type', 'subtype', 'error', 'kind', 'presence', 'mode', 'variant', 'reason', 'priority', 'style'])
const TS = /^\d{10}\.\d{6}$/
const ID = /^[A-Z][A-Z0-9]{4,}$/

export function redact(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => redact(item))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[ID.test(k) ? 'ID' : k] = redact(v, k)
    return out
  }
  if (typeof value === 'string') {
    if (key !== undefined && KEEP_KEYS.has(key)) return value
    if (TS.test(value)) return '1700000000.000001'
    if (ID.test(value)) return `${value[0]}0REDACTED`
    if (/^https?:\/\//.test(value)) return 'https://redacted.invalid/'
    if (/^wss?:\/\//.test(value)) return 'wss://redacted.invalid/'
    if (value.startsWith('xox')) return 'xoxc-redacted'
    return value === '' ? '' : 'redacted'
  }
  if (typeof value === 'number') return Number.isInteger(value) ? (value > 1_000_000_000 ? 1_700_000_000 : value) : 0.5
  return value
}
