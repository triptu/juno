/**
 * Import from the installed Slack app (architecture 14).
 *
 * `slackAppData.ts` finds the install (on the Mac the direct download or the
 * App Store build; on Windows the installer, MSIX or Microsoft Store build),
 * copies its Local Storage and cookie store to a temp directory and reads the
 * team and `d` cookie from the copy. This module adds the Electron parts: the
 * keychain on the Mac (`security find-generic-password`, which makes macOS
 * ask the user), DPAPI on Windows (`dpapi.ts`, no prompt), the versions for
 * the failure report, and writing the `d` cookie into the `persist:slack`
 * session.
 *
 * The passwords macOS gives are kept in memory until Juno quits or signs
 * out, so pressing "Use the Slack app's session" again (after a failure, or
 * a session Slack later expires) does not make macOS ask again.
 *
 * Test seam: `JUNO_SLACK_APP_DIR` points at a fixture directory and
 * `JUNO_SLACK_SAFE_STORAGE_PASSWORD` stands in for the Mac's keychain, both
 * read only under `JUNO_E2E`. On Windows the fixture's `Local State` holds the
 * key unprotected. No value from either path is ever logged.
 */
import { app, session as electronSession } from 'electron'
import { join } from 'node:path'
import type { SessionSecrets, SignInFailureKind } from '@juno/contract'
import { KEYCHAIN_SERVICE, slackAppCandidates, windowsSlackAppCandidates, type SlackAppCandidate, type SlackCookie } from '@juno/slack/import'
import { loadUnprotect } from './dpapi'
import { securityRunner } from './keychain'
import { SLACK_PARTITION } from './slackSession'
import { fixedKeychain, readSlackApp, securityKeychain, UNREADABLE, type SlackKeychain } from './slackAppData'

export type ImportResult =
  | { readonly ok: true; readonly secrets: SessionSecrets }
  | { readonly ok: false; readonly kind: SignInFailureKind; readonly message: string; readonly details?: string }

export interface ImportOptions {
  /** One Slack data directory to use instead of the installed app's. Tests only. */
  readonly slackDir?: string
  /** Skips the keychain prompt. Tests only. */
  readonly keychainPassword?: string
}

/** Where the installed Slack app may keep its data, the direct download first. */
export function defaultSlackCandidates(): ReadonlyArray<SlackAppCandidate> {
  if (process.platform === 'win32') return windowsSlackAppCandidates({ appData: app.getPath('appData'), localAppData: localAppData() })
  return slackAppCandidates(app.getPath('home'))
}

/** `%LOCALAPPDATA%`, which Electron has no name for. */
function localAppData(): string {
  return process.env.LOCALAPPDATA ?? join(app.getPath('home'), 'AppData', 'Local')
}

/**
 * The keychain prompt waits on the user to find and type their password, so
 * `security` gets five minutes. A shorter limit ends the read while the
 * prompt is still up, and the next press asks again.
 */
const SECURITY_TIMEOUT_MS = 300_000

/** Slack's keychain passwords macOS gave in this run, by service. Never written anywhere. */
const known = new Map<string, string>()
let keychainReads = 0

/** Forgets the passwords, as signing out does. */
export function forgetSlackKeychain(): void {
  known.clear()
}

/** How many times this run asked the keychain for a Slack password, each a possible prompt. For tests. */
export function slackKeychainReads(): number {
  return keychainReads
}

/** Counts each read that reaches the keychain. */
function counted(keychain: SlackKeychain): SlackKeychain {
  return {
    ...keychain,
    read: (service) => {
      keychainReads++
      return keychain.read(service)
    },
  }
}

export async function importFromSlackApp(options: ImportOptions = {}): Promise<ImportResult> {
  const home = app.getPath('home')
  const seam = options.slackDir !== undefined
  const read = process.platform === 'win32' ? await readWindows(home, options.slackDir) : await readSlackApp({
    candidates: seam ? [{ variant: 'direct', dir: options.slackDir, keychainService: KEYCHAIN_SERVICE }] : defaultSlackCandidates(),
    keychain: counted(options.keychainPassword === undefined ? securityKeychain(securityRunner(SECURITY_TIMEOUT_MS)) : fixedKeychain(options.keychainPassword)),
    known,
    // Under the test seam the report names no real Slack.app.
    bundles: seam ? [] : ['/Applications/Slack.app', join(home, 'Applications', 'Slack.app')],
    junoVersion: app.getVersion(),
    macosVersion: process.getSystemVersion(),
    home,
  })
  if (!read.ok) return read
  const { team, cookie } = read
  try {
    await storeCookie(team.url, cookie)
  } catch {
    return { ok: false, kind: 'other', message: UNREADABLE }
  }
  return {
    ok: true,
    secrets: {
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
    },
  }
}

/**
 * Windows: no keychain. Under the test seam the fixture's `Local State` holds
 * the key itself, so unprotecting it gives it back unchanged.
 */
async function readWindows(home: string, slackDir: string | undefined) {
  if (slackDir !== undefined) {
    return readSlackApp({
      os: 'windows',
      candidates: [{ variant: 'direct', dir: slackDir }],
      unprotect: (blob) => blob,
      installDir: slackDir,
      junoVersion: app.getVersion(),
      windowsVersion: process.getSystemVersion(),
      home,
    })
  }
  const unprotect = await loadUnprotect()
  return readSlackApp({
    os: 'windows',
    candidates: defaultSlackCandidates(),
    // Without koffi the key stays locked, and the report says so.
    unprotect: unprotect ?? (() => undefined),
    installDir: join(localAppData(), 'slack'),
    junoVersion: app.getVersion(),
    windowsVersion: process.getSystemVersion(),
    home,
  })
}

/** Writes the cookie into the session the engine uses. */
async function storeCookie(workspaceUrl: string, cookie: SlackCookie): Promise<void> {
  const slackSession = electronSession.fromPartition(SLACK_PARTITION)
  await slackSession.cookies.set({
    url: workspaceUrl,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.host.startsWith('.') ? { domain: cookie.host } : {}),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: 'lax',
    ...(cookie.expires === undefined ? {} : { expirationDate: cookie.expires }),
  })
  await slackSession.cookies.flushStore()
}
