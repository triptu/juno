/**
 * What main does for the engine, for the web shell and the browser e2e host:
 * keeps the Slack session (the secrets and the `d` cookie Chromium would
 * hold), answers sign-in by "importing" a session the caller makes on the
 * fake Slack, gives the socket handshake its cookie, and sends the engine's
 * requests to the fake with that cookie.
 *
 * `aliases` are other origins that mean this fake: a synced snapshot was made
 * against a fake on another port, and its stored avatar and file addresses
 * name that port. Requests to an alias go to this fake.
 */
import type { ReadySession, SessionSecrets } from '@juno/contract'
import type { memoryHost } from '@juno/engine'
import type { Credentials } from '@juno/fake-slack'
import { HttpTransport } from '@juno/slack'

/** The session main keeps: what `secrets.bin` and the Slack cookie jar hold in the app. */
export interface StoredSession {
  readonly secrets: SessionSecrets
  readonly cookie: string
}

export interface SessionStore {
  readonly load: () => StoredSession | null
  readonly save: (session: StoredSession | null) => void
  /** The last verified session, for the first frame of the next load (`?session=`). */
  readonly ready?: (session: ReadySession | undefined) => void
}

/** A store that lives as long as the process. */
export function memorySessionStore(initial: StoredSession | null): SessionStore {
  let stored = initial
  return { load: () => stored, save: (session) => (stored = session) }
}

export function storedSession(credentials: Credentials): StoredSession {
  return {
    secrets: { teamId: credentials.teamId, userId: credentials.userId, workspaceUrl: credentials.url, token: credentials.token, teamName: 'Juno Fake' },
    cookie: credentials.cookie,
  }
}

export interface FakeMainOptions {
  readonly fakeUrl: string
  readonly aliases?: ReadonlyArray<string>
  readonly store: SessionStore
  /** A new session on the fake, as an import from the Slack app finds one. */
  readonly signIn: () => Promise<Credentials>
}

/** The fake's own address for `url` when it names the fake or an alias, else undefined. */
export function fakeAddress(url: URL, fakeUrl: string, aliases: ReadonlyArray<string> = []): URL | undefined {
  const fake = new URL(fakeUrl)
  if (url.origin === fake.origin) return url
  if (!aliases.includes(url.origin)) return undefined
  const moved = new URL(url)
  moved.protocol = fake.protocol
  moved.host = fake.host
  return moved
}

export function fakeMain(host: ReturnType<typeof memoryHost>, options: FakeMainOptions) {
  const aliases = options.aliases ?? []
  const cookie = () => {
    const stored = options.store.load()
    return stored === null ? '' : `d=${stored.cookie}`
  }
  let pending: StoredSession | undefined
  host.onEngine((message) => {
    switch (message._tag) {
      case 'requestSecrets':
        host.deliver({ _tag: 'secrets', secrets: options.store.load()?.secrets ?? null })
        return
      case 'importFromSlackApp':
        void options.signIn().then((credentials) => {
          pending = storedSession(credentials)
          host.deliver({ _tag: 'secrets', secrets: pending.secrets })
        })
        return
      case 'storeSecrets': {
        const cookieFrom = pending?.secrets.token === message.secrets.token ? pending.cookie : (options.store.load()?.cookie ?? '')
        options.store.save({ secrets: message.secrets, cookie: cookieFrom })
        pending = undefined
        host.deliver({ _tag: 'secretsStored' })
        return
      }
      case 'signOut':
        options.store.save(null)
        options.store.ready?.(undefined)
        host.deliver({ _tag: 'signedOut' })
        return
      case 'sessionReady':
        options.store.ready?.(message.session)
        return
      case 'authRequired':
        options.store.ready?.(undefined)
        return
      case 'handshake':
        host.deliver({ _tag: 'handshake', id: message.id, cookie: pending === undefined ? cookie() : `d=${pending.cookie}`, origin: 'https://app.slack.com', userAgent: 'Juno web', proxy: 'DIRECT' })
        return
      default:
        return
    }
  })
  // The cookie Chromium would attach on the Slack session.
  const httpTransport = HttpTransport.nodeFetch({
    fetch: async (input, init) => {
      const url = fakeAddress(new URL(input instanceof Request ? input.url : input), options.fakeUrl, aliases)
      if (url === undefined) throw new Error('The web host only contacts its fake Slack')
      const headers = new Headers(init?.headers)
      headers.set('cookie', pending === undefined ? cookie() : `d=${pending.cookie}`)
      return fetch(url, { ...init, headers, redirect: 'error' })
    },
  })
  return { httpTransport, cookie }
}
