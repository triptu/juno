/**
 * Import from the installed Slack app (architecture 14).
 *
 * `slackAppData.ts` finds the install (direct download or Mac App Store),
 * copies its Local Storage and cookie store to a temp directory and reads the
 * team and `d` cookie from the copy. This module adds the Electron parts: the
 * keychain (`security find-generic-password`, which makes macOS ask the
 * user), the versions for the failure report, and writing the `d` cookie
 * into the `persist:slack` session.
 *
 * Test seam: `JUNO_SLACK_APP_DIR` points at a fixture directory and
 * `JUNO_SLACK_SAFE_STORAGE_PASSWORD` stands in for the keychain, both read
 * only under `JUNO_E2E`. No value from either path is ever logged.
 */
import { app, session as electronSession } from 'electron'
import { join } from 'node:path'
import type { SessionSecrets, SignInFailureKind } from '@juno/contract'
import { KEYCHAIN_SERVICE, slackAppCandidates, type SlackAppCandidate, type SlackCookie } from '@juno/slack/import'
import { securityRunner } from './keychain'
import { SLACK_PARTITION } from './signInWindow'
import { fixedKeychain, readSlackApp, securityKeychain, UNREADABLE } from './slackAppData'

export type ImportResult =
  | { readonly ok: true; readonly secrets: SessionSecrets }
  | { readonly ok: false; readonly kind: SignInFailureKind; readonly message: string; readonly details?: string }

export interface ImportOptions {
  /** One Slack data directory to use instead of the installed app's. Tests only. */
  readonly slackDir?: string
  /** Skips the keychain prompt. Tests only. */
  readonly keychainPassword?: string
}

/** Where the installed Slack app may keep its data: the direct download first, then the App Store sandbox. */
export function defaultSlackCandidates(): ReadonlyArray<SlackAppCandidate> {
  return slackAppCandidates(app.getPath('home'))
}

/** The keychain prompt waits on the user, so `security` gets two minutes. */
const SECURITY_TIMEOUT_MS = 120_000

export async function importFromSlackApp(options: ImportOptions = {}): Promise<ImportResult> {
  const home = app.getPath('home')
  const seam = options.slackDir !== undefined
  const read = await readSlackApp({
    candidates: seam ? [{ variant: 'direct', dir: options.slackDir, keychainService: KEYCHAIN_SERVICE }] : defaultSlackCandidates(),
    keychain: options.keychainPassword === undefined ? securityKeychain(securityRunner(SECURITY_TIMEOUT_MS)) : fixedKeychain(options.keychainPassword),
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

/** Writes the cookie into the session the engine and the sign-in window share. */
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
