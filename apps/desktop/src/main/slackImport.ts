/**
 * Import from the installed Slack app (architecture 14).
 *
 * Copies `Local Storage/leveldb` and `Cookies` out of the Slack app's user
 * data into a temp directory, reads the keychain password for "Slack Safe
 * Storage" (`security find-generic-password`, which makes macOS ask the
 * user), parses the copies with `@juno/slack/import`, writes the `d` cookie
 * into the `persist:slack` session, and deletes the copies. The live files
 * are never opened, so the Slack app may be running.
 *
 * Test seam: `JUNO_SLACK_APP_DIR` points at a fixture directory and
 * `JUNO_SLACK_SAFE_STORAGE_PASSWORD` stands in for the keychain, both read
 * only under `JUNO_E2E`. No value from either path is ever logged.
 */
import { app, session as electronSession } from 'electron'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionSecrets, SignInFailureKind } from '@juno/contract'
import { COOKIES_FILE, LOCAL_STORAGE_DIR, readSlackAppSession, SlackAppImportError, type SlackCookie } from '@juno/slack/import'
import { SLACK_PARTITION } from './signInWindow'

export const KEYCHAIN_SERVICE = 'Slack Safe Storage'

export type ImportResult =
  | { readonly ok: true; readonly secrets: SessionSecrets }
  | { readonly ok: false; readonly kind: SignInFailureKind; readonly message: string }

export interface ImportOptions {
  /** The Slack app's user data directory. Default: `~/Library/Application Support/Slack`. */
  readonly slackDir?: string
  /** Skips the keychain prompt. Tests only. */
  readonly keychainPassword?: string
}

export function defaultSlackDir(): string {
  return join(app.getPath('appData'), 'Slack')
}

export async function importFromSlackApp(options: ImportOptions = {}): Promise<ImportResult> {
  const slackDir = options.slackDir ?? defaultSlackDir()
  if (!(await exists(join(slackDir, LOCAL_STORAGE_DIR))) || !(await exists(join(slackDir, COOKIES_FILE)))) {
    return { ok: false, kind: 'no-slack-app', message: 'No signed-in Slack app was found on this Mac.' }
  }

  const copy = await mkdtemp(join(tmpdir(), 'juno-import-'))
  try {
    await cp(join(slackDir, LOCAL_STORAGE_DIR), join(copy, LOCAL_STORAGE_DIR), { recursive: true })
    await cp(join(slackDir, COOKIES_FILE), join(copy, COOKIES_FILE))
    // SQLite may have a journal with the latest rows.
    const journal = `${COOKIES_FILE}-journal`
    if (await exists(join(slackDir, journal))) await cp(join(slackDir, journal), join(copy, journal))

    const keychainPassword = options.keychainPassword ?? (await readKeychainPassword())
    if (keychainPassword === undefined) {
      return { ok: false, kind: 'keychain', message: 'Juno could not read the Slack keychain item. Allow access when macOS asks, or sign in instead.' }
    }

    const { team, cookie } = await readSlackAppSession({ dir: copy, keychainPassword })
    await storeCookie(team.url, cookie)
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
  } catch (cause) {
    if (cause instanceof SlackAppImportError) {
      return cause.reason === 'no-cookie'
        ? { ok: false, kind: 'keychain', message: 'The Slack keychain item did not unlock the session cookie. Sign in instead.' }
        : { ok: false, kind: 'no-slack-app', message: 'The Slack app has no signed-in workspace.' }
    }
    return { ok: false, kind: 'other', message: 'The Slack app’s data could not be read.' }
  } finally {
    await rm(copy, { recursive: true, force: true })
  }
}

/** The keychain password, or undefined when the user declined or the item is missing. Never logged. */
function readKeychainPassword(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', KEYCHAIN_SERVICE], { timeout: 120_000 }, (error, stdout) => {
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
