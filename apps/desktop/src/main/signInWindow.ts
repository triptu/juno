/**
 * The embedded sign-in window (architecture 14).
 *
 * A plain `BrowserWindow` on the `persist:slack` partition with no preload,
 * so the `d` cookie Slack sets lands in the session the engine uses.
 * Navigation is allow-listed to Slack domains (plus the fake's host in
 * tests); anything else is blocked, and `window.open` goes to the system
 * browser for https links.
 *
 * Capture: once the page reaches `/client/<team>`, main reads
 * `localStorage.localConfig_v2` with `executeJavaScript` and takes that
 * team's record. If that gives no token, a `webRequest.onBeforeRequest`
 * listener sniffs the body of the first `/api/` call for the `token` field
 * and is unregistered right after (ADR 0007: the engine's own requests pass
 * the same listener). The window closes when a token is captured. Closing
 * it before that is a cancellation.
 */
import { BrowserWindow, session as electronSession, shell, type Session } from 'electron'
import type { SessionSecrets, SignInFailureKind } from '@juno/contract'
import { pickTeam } from '@juno/slack/import'

export const SLACK_PARTITION = 'persist:slack'

/** Where the official shell starts (research slack-desktop-shell section 3). */
export const SLACK_SIGN_IN_URL = 'https://slack.com/signin'

/** Hosts the sign-in window may show. Subdomains are allowed. */
export const SLACK_HOSTS = ['slack.com', 'slack-edge.com', 'slackb.com', 'slack-imgs.com']

export type SignInCapture =
  | { readonly ok: true; readonly secrets: SessionSecrets }
  | { readonly ok: false; readonly kind: SignInFailureKind; readonly message: string }

export interface SignInWindowOptions {
  readonly startUrl?: string
  /** Extra hosts to allow, for the fake in tests. */
  readonly extraHosts?: ReadonlyArray<string>
  readonly parent?: BrowserWindow
}

const CLIENT_PATH = /^\/client\/([A-Z0-9]+)/

export function isAllowedHost(hostname: string, hosts: ReadonlyArray<string>): boolean {
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

/** Opens the window and resolves when a session is captured or the window closes. One at a time. */
export function openSignInWindow(options: SignInWindowOptions = {}): Promise<SignInCapture> {
  const hosts = [...SLACK_HOSTS, ...(options.extraHosts ?? [])]
  const allowed = (url: string) => {
    try {
      return isAllowedHost(new URL(url).hostname, hosts)
    } catch {
      return false
    }
  }
  const slackSession = electronSession.fromPartition(SLACK_PARTITION)
  const guard = (event: { preventDefault: () => void }, url: string) => {
    if (!allowed(url)) event.preventDefault()
  }

  return new Promise((resolve) => {
    let settled = false
    let sniffing = false
    const window = new BrowserWindow({
      width: 560,
      height: 760,
      show: false,
      title: 'Sign in to Slack',
      ...(options.parent === undefined ? {} : { parent: options.parent }),
      webPreferences: {
        partition: SLACK_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
      },
    })
    const contents = window.webContents

    const finish = (capture: SignInCapture) => {
      if (settled) return
      settled = true
      if (sniffing) {
        slackSession.webRequest.onBeforeRequest(null)
        sniffing = false
      }
      // The cookie is in the session; make sure it reaches disk before anything else happens.
      if (capture.ok) void slackSession.cookies.flushStore()
      resolve(capture)
      if (!window.isDestroyed()) window.close()
    }

    contents.on('will-navigate', guard)
    contents.on('will-redirect', guard)
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })

    const tryCapture = async () => {
      if (settled) return
      const url = new URL(contents.getURL())
      const teamId = CLIENT_PATH.exec(url.pathname)?.[1]
      if (teamId === undefined) return
      const fromStorage = await readLocalConfig(contents, teamId)
      if (fromStorage !== undefined) return finish({ ok: true, secrets: fromStorage })
      if (!sniffing) startSniff(slackSession, teamId, finish)
      sniffing = true
    }
    contents.on('did-finish-load', () => void tryCapture())
    contents.on('did-navigate-in-page', () => void tryCapture())

    window.once('ready-to-show', () => window.show())
    window.on('closed', () => finish({ ok: false, kind: 'cancelled', message: 'The sign-in window was closed before it finished.' }))

    void window.loadURL(options.startUrl ?? SLACK_SIGN_IN_URL)
  })
}

async function readLocalConfig(contents: Electron.WebContents, teamId: string): Promise<SessionSecrets | undefined> {
  try {
    const json = (await contents.executeJavaScript("localStorage.getItem('localConfig_v2')", true)) as unknown
    if (typeof json !== 'string') return undefined
    const team = pickTeam(json, teamId)
    if (team === undefined) return undefined
    return {
      teamId: team.id,
      userId: team.user_id,
      workspaceUrl: team.url,
      token: team.token,
      ...(team.name === undefined ? {} : { teamName: team.name }),
      ...(team.domain === undefined ? {} : { teamDomain: team.domain }),
      ...(team.enterprise_id === undefined
        ? {}
        : {
            enterprise: {
              id: team.enterprise_id,
              ...(team.enterprise_api_token === undefined ? {} : { token: team.enterprise_api_token }),
              ...(team.enterprise_name === undefined ? {} : { name: team.enterprise_name }),
            },
          }),
    }
  } catch {
    return undefined
  }
}

const TOKEN = /xoxc-[A-Za-z0-9-]+/

/** The fallback: the first `/api/` request body with a token. The user id is filled in by `auth.test` in the engine. */
function startSniff(slackSession: Session, teamId: string, finish: (capture: SignInCapture) => void): void {
  slackSession.webRequest.onBeforeRequest({ urls: ['*://*/api/*'] }, (details, callback) => {
    callback({})
    for (const part of details.uploadData ?? []) {
      const match = TOKEN.exec(part.bytes.toString('latin1'))
      if (match !== null) {
        finish({ ok: true, secrets: { teamId, userId: '', workspaceUrl: `${new URL(details.url).origin}/`, token: match[0] } })
        return
      }
    }
  })
}
