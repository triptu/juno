/**
 * Main's half of the session (architecture 2.3, 2.4, 14): answers what the
 * engine asks over parentPort and does the Electron work. No decisions live
 * here; the engine owns the session state.
 *
 * - `requestSecrets`: read `secrets.bin`.
 * - `importFromSlackApp`: capture a session and answer with
 *   `secrets` or `sessionFailed`. The engine verifies it; only then does it
 *   send `storeSecrets`. Every answer echoes the request's `id`, so an
 *   engine started after a crash ignores an import the crashed one began.
 * - `signOut`: delete `secrets.bin`, clear the `persist:slack` session and
 *   forget the Slack keychain password an import read. The engine always
 *   hears `signedOut`, even when a stage fails.
 * - `sessionReady`: keep the verified session, with no secrets, for the next
 *   launch's first frame (`launch.json`). `signOut` and `authRequired` drop it.
 * - `handshake`: the cookie header, origin, user agent and proxy for a
 *   socket URL (ADR 0007). `setCookies`: store `Set-Cookie` values from an
 *   upgrade response.
 */
import type { EngineToMain, MainToEngine, ReadySession } from '@juno/contract'
import type { Level } from '../logging'
import type { SecretsStore } from './secrets'
import type { ImportResult } from './slackImport'

const SOCKET_ORIGIN = 'https://app.slack.com'

/** What main asks of the `persist:slack` Electron session. */
export interface SlackSession {
  clearStorageData(): Promise<void>
  clearCache(): Promise<void>
  readonly cookies: {
    get(filter: { readonly url: string }): Promise<ReadonlyArray<{ readonly name: string; readonly value: string }>>
    set(details: { readonly url: string } & ParsedCookie): Promise<void>
  }
  resolveProxy(url: string): Promise<string>
  getUserAgent(): string
}

export interface SessionHostDeps {
  readonly secrets: Pick<SecretsStore, 'read' | 'write' | 'delete'>
  readonly send: (message: MainToEngine) => void
  /** Captures the installed Slack app's session (`slackImport.ts`). */
  readonly importSession: () => Promise<ImportResult>
  /** Forgets the Slack keychain password an import read. */
  readonly forgetKeychain: () => void
  readonly slackSession: () => SlackSession
  /** Keeps the verified session for the next launch, or drops it. */
  readonly saveSession: (session: ReadySession | undefined) => void
  readonly log: (level: Level, message: string, data?: Record<string, unknown>) => void
}

export class SessionHost {
  readonly #deps: SessionHostDeps
  #busy = false

  constructor(deps: SessionHostDeps) {
    this.#deps = deps
  }

  /** Handles one message from the engine. Returns false for messages that are not about the session. */
  handle(message: EngineToMain): boolean {
    if (['requestSecrets', 'importFromSlackApp', 'storeSecrets', 'signOut', 'authRequired'].includes(message._tag)) this.#deps.log('INFO', 'sign-in step', { step: message._tag })
    switch (message._tag) {
      case 'requestSecrets':
        void this.#deps.secrets.read().then((secrets) => this.#deps.send({ _tag: 'secrets', id: message.id, secrets }))
        return true
      case 'importFromSlackApp':
        void this.#capture(message.id, 'import', this.#deps.importSession)
        return true
      case 'storeSecrets':
        void this.#deps.secrets.write(message.secrets).then(() => {
          this.#deps.send({ _tag: 'secretsStored', id: message.id })
        }).catch((cause: unknown) => {
          console.error('main: could not write secrets.bin', cause instanceof Error ? cause.name : '')
          this.#deps.send({ _tag: 'sessionFailed', id: message.id, method: message.method, kind: 'other', message: 'Juno could not save the Slack session. Try signing in again.' })
        })
        return true
      case 'signOut':
        void this.#signOut()
        return true
      case 'sessionReady':
        this.#deps.saveSession(message.session)
        return true
      case 'authRequired':
        console.warn(`main: slack session needs a new sign-in (${message.reason})`)
        this.#deps.saveSession(undefined)
        return true
      case 'handshake':
        void this.#handshake(message.id, message.url)
        return true
      case 'setCookies':
        void this.#setCookies(message.url, message.cookies)
        return true
      default:
        return false
    }
  }

  async #capture(id: string, method: 'import', run: () => Promise<ImportResult>): Promise<void> {
    if (this.#busy) {
      this.#deps.send({ _tag: 'sessionFailed', id, method, kind: 'other', message: 'A sign-in is already in progress.' })
      return
    }
    this.#busy = true
    try {
      const result = await run()
      if (result.ok) this.#deps.send({ _tag: 'secrets', id, secrets: result.secrets })
      else
        this.#deps.send({
          _tag: 'sessionFailed',
          id,
          method,
          kind: result.kind,
          message: result.message,
          ...(result.details === undefined ? {} : { details: result.details }),
        })
    } catch (cause) {
      console.error('main: sign-in failed', cause instanceof Error ? cause.name : '')
      this.#deps.send({ _tag: 'sessionFailed', id, method, kind: 'other', message: 'The sign-in did not finish.' })
    } finally {
      this.#busy = false
    }
  }

  /**
   * Every stage runs, and the engine hears `signedOut` whatever failed: it has
   * closed the workspace and waits for the answer before it reports the user
   * signed out. A failed stage is logged with its name.
   */
  async #signOut(): Promise<void> {
    this.#deps.saveSession(undefined)
    const stage = async (name: string, run: () => Promise<void>) => {
      try {
        await run()
      } catch (cause) {
        this.#deps.log('ERROR', 'sign-out stage failed', { stage: name, error: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    await stage('delete secrets.bin', () => this.#deps.secrets.delete())
    this.#deps.forgetKeychain()
    const slackSession = this.#deps.slackSession()
    await stage('clear storage', () => slackSession.clearStorageData())
    await stage('clear cache', () => slackSession.clearCache())
    this.#deps.send({ _tag: 'signedOut' })
  }

  async #handshake(id: number, url: string): Promise<void> {
    const slackSession = this.#deps.slackSession()
    const httpUrl = url.replace(/^ws/, 'http')
    const cookies = await slackSession.cookies.get({ url: httpUrl })
    const proxy = await slackSession.resolveProxy(httpUrl).catch(() => 'DIRECT')
    this.#deps.send({
      _tag: 'handshake',
      id,
      cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
      origin: SOCKET_ORIGIN,
      userAgent: slackSession.getUserAgent(),
      proxy,
    })
  }

  async #setCookies(url: string, cookies: ReadonlyArray<string>): Promise<void> {
    const slackSession = this.#deps.slackSession()
    const httpUrl = url.replace(/^ws/, 'http')
    for (const header of cookies) {
      const parsed = parseSetCookie(header)
      if (parsed === undefined) continue
      try {
        await slackSession.cookies.set({ url: httpUrl, ...parsed })
      } catch (cause) {
        console.warn('main: could not store a socket cookie', cause instanceof Error ? cause.message : '')
      }
    }
  }
}

interface ParsedCookie {
  readonly name: string
  readonly value: string
  readonly domain?: string
  readonly path?: string
  readonly secure?: boolean
  readonly httpOnly?: boolean
  readonly expirationDate?: number
  readonly sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/** `name=value; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=...` into `cookies.set` fields. */
export function parseSetCookie(header: string): ParsedCookie | undefined {
  const [pair, ...attributes] = header.split(';')
  const eq = pair?.indexOf('=') ?? -1
  if (pair === undefined || eq <= 0) return undefined
  const cookie: { -readonly [K in keyof ParsedCookie]: ParsedCookie[K] } = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() }
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=')
    const key = rawKey?.trim().toLowerCase()
    const value = rest.join('=').trim()
    switch (key) {
      case 'domain':
        cookie.domain = value.startsWith('.') ? value : `.${value}`
        break
      case 'path':
        cookie.path = value
        break
      case 'secure':
        cookie.secure = true
        break
      case 'httponly':
        cookie.httpOnly = true
        break
      case 'max-age': {
        const seconds = Number(value)
        if (Number.isFinite(seconds)) cookie.expirationDate = Math.floor(Date.now() / 1000) + seconds
        break
      }
      case 'expires': {
        const at = Date.parse(value)
        if (!Number.isNaN(at) && cookie.expirationDate === undefined) cookie.expirationDate = Math.floor(at / 1000)
        break
      }
      case 'samesite': {
        const mode = value.toLowerCase()
        cookie.sameSite = mode === 'strict' ? 'strict' : mode === 'none' ? 'no_restriction' : mode === 'lax' ? 'lax' : 'unspecified'
        break
      }
      default:
        break
    }
  }
  return cookie
}
