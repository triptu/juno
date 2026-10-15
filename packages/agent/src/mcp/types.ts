import { Schema } from 'effect'
import type { McpOAuthStateStore } from '@earendil-works/pi-mcp/oauth'

export const ConnectionConfig = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  url: Schema.String,
  transport: Schema.Literal('http'),
  auth: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('none') }),
    Schema.Struct({ kind: Schema.Literal('oauth') }),
    Schema.Struct({ kind: Schema.Literal('bearer'), secretRef: Schema.String }),
  ]),
  trusted: Schema.Boolean,
  noSecrets: Schema.Boolean,
  allowlist: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
  /** T3 Code only: false keeps it on this Mac; true allows a private HTTP or HTTPS address on the network. */
  allowNetwork: Schema.optionalKey(Schema.Boolean),
})
export type ConnectionConfig = typeof ConnectionConfig.Type

/** Main supplies keychain-backed storage. Neither the renderer nor SQLite gets these values. */
export interface Credentials {
  readonly oauth: (id: string) => McpOAuthStateStore
  readonly bearer: (ref: string) => Promise<string | undefined>
  readonly values: () => Promise<ReadonlyArray<string>>
  readonly clear: (id: string) => Promise<void>
  readonly openAuthorization: (url: string) => Promise<void>
}

export class McpError extends Schema.TaggedError<McpError>()('McpError', {
  reason: Schema.Literals(['unavailable', 'invalid', 'stale', 'secret', 'destructive']),
  message: Schema.String,
}) {}

export const NOTION: ConnectionConfig = {
  id: 'notion', label: 'Notion', url: 'https://mcp.notion.com/mcp', transport: 'http',
  auth: { kind: 'oauth' }, trusted: false, noSecrets: false,
  allowlist: ['notion-search', 'notion-fetch', 'search', 'fetch'], enabled: false,
}

/** Read names must be confirmed from discovery and reviewed by the owner, never guessed. */
export const LITTLEBIRD: ConnectionConfig = {
  id: 'littlebird', label: 'Littlebird', url: 'https://mcp.littlebird.ai/mcp', transport: 'http',
  auth: { kind: 'oauth' }, trusted: false, noSecrets: false,
  allowlist: [], enabled: false,
}

/** T3 Code signs in once with OAuth and has no refresh, so an expired token needs a new sign-in. */
export const T3: ConnectionConfig = {
  id: 't3', label: 'T3 Code', url: 'http://localhost:3773/mcp', transport: 'http',
  auth: { kind: 'oauth' }, trusted: false, noSecrets: true,
  allowlist: ['t3_thread_read', 't3_thread_list', 't3_thread_search', 't3_thread_wait', 't3_pending_request_list', 't3_pending_request_read', 't3_project_list', 't3_worktree_list', 't3_worktree_status'],
  enabled: false, allowNetwork: false,
}

export const PRESETS: ReadonlyArray<ConnectionConfig> = [NOTION, LITTLEBIRD, T3]

export function endpoint(url: string, allowNetwork = true, localNetwork = false): string {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new McpError({ reason: 'invalid', message: 'Enter a full address, like https://mcp.example.com/mcp.' }) }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  const privateHost = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|169\.254\.)/.test(parsed.hostname)
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && (loopback || (localNetwork && privateHost)))) || parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new McpError({ reason: 'invalid', message: 'Use HTTPS, or HTTP on this Mac, without credentials in the address.' })
  }
  if (!allowNetwork && !loopback) throw new McpError({ reason: 'invalid', message: 'Allow the local network to use an address on another machine.' })
  return parsed.href
}

export const denied = (name: string): boolean => /(^|[-_.])(delete|remove|archive|trash|merge|purchase|buy|force[-_]?push)([-_.]|$)/i.test(name.replace(/([a-z])([A-Z])/g, '$1-$2'))

export function hasSecret(value: unknown, secrets: ReadonlyArray<string>): boolean {
  if (typeof value === 'string') return secrets.some((secret) => secret.length > 0 && value.includes(secret)) || /(?:sk-(?:or-v1-|proj-)?[a-zA-Z0-9_-]{16,}|xox[baprs]-[a-zA-Z0-9-]{10,}|gh[pousr]_[a-zA-Z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(value)
  if (Array.isArray(value)) return value.some((item) => hasSecret(item, secrets))
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) => hasSecret(key, secrets) || hasSecret(item, secrets))
}

/** Destructive operations can also hide behind a generic update tool. */
export function destructiveArguments(args: unknown): boolean {
  if (Array.isArray(args)) return args.some(destructiveArguments)
  if (args === null || typeof args !== 'object') return false
  return Object.entries(args).some(([key, value]) =>
    ((key === 'archived' || key === 'in_trash' || key === 'delete') && value === true) ||
    ((key === 'command' || key === 'operation' || key === 'action') && typeof value === 'string' && denied(value)) ||
    destructiveArguments(value))
}
