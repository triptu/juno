/**
 * Import from the installed Slack app (architecture 14).
 *
 * `slackAppData.ts` finds the install (direct download or Mac App Store),
 * copies its Local Storage and cookie store to a temp directory and reads the
 * team and `d` cookie from the copy. This module adds the Electron parts: the
 * keychain password (`security find-generic-password`, which makes macOS ask
 * the user) and writing the `d` cookie into the `persist:slack` session.
 *
 * Test seam: `JUNO_SLACK_APP_DIR` points at a fixture directory and
 * `JUNO_SLACK_SAFE_STORAGE_PASSWORD` stands in for the keychain, both read
 * only under `JUNO_E2E`. No value from either path is ever logged.
 */
import { app, session as electronSession } from 'electron'
import { execFile } from 'node:child_process'
import type { SessionSecrets, SignInFailureKind } from '@juno/contract'
import { KEYCHAIN_SERVICE, slackAppCandidates, type SlackAppCandidate, type SlackCookie } from '@juno/slack/import'
import { SLACK_PARTITION } from './signInWindow'
import { readSlackApp, UNREADABLE } from './slackAppData'

export type ImportResult =
  | { readonly ok: true; readonly secrets: SessionSecrets }
  | { readonly ok: false; readonly kind: SignInFailureKind; readonly message: string }

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

export async function importFromSlackApp(options: ImportOptions = {}): Promise<ImportResult> {
  const candidates =
    options.slackDir === undefined ? defaultSlackCandidates() : [{ variant: 'direct' as const, dir: options.slackDir, keychainService: KEYCHAIN_SERVICE }]
  const { keychainPassword } = options
  const read = await readSlackApp({
    candidates,
    keychainPassword: keychainPassword === undefined ? readKeychainPassword : async () => keychainPassword,
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

/** The keychain password, or undefined when the user declined or the item is missing. Never logged. */
function readKeychainPassword(service: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', service], { timeout: 120_000 }, (error, stdout) => {
      if (error) return resolve(undefined)
      const password = stdout.replace(/\n$/, '')
      resolve(password === '' ? undefined : password)
    })
  })
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
