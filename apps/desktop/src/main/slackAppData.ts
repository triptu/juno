/**
 * The Electron-free half of the Slack app import (architecture 14): find the
 * install, copy its data to a temp directory, read the team and the `d`
 * cookie from the copy, and turn each failure into the line the sign-in page
 * shows. The live files are never opened, so the Slack app may be running.
 *
 * One info line names the install used (`direct` or `app-store`) and the
 * cookie store path inside it, so a support report says where Juno looked.
 * No value from the files or the keychain is ever logged.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SignInFailureKind } from '@juno/contract'
import {
  copySlackAppData,
  locateSlackAppData,
  readSlackAppSession,
  SlackAppImportError,
  type LocalConfigTeam,
  type SlackAppCandidate,
  type SlackCookie,
} from '@juno/slack/import'

export type SlackAppRead =
  | { readonly ok: true; readonly team: LocalConfigTeam; readonly cookie: SlackCookie }
  | { readonly ok: false; readonly kind: SignInFailureKind; readonly message: string }

export const NOT_INSTALLED = 'Slack isn’t installed on this Mac.'
export const SIGNED_OUT = 'Slack is installed but not signed in. Sign in to Slack in its app first, or use Sign in to Slack.'
export const NO_KEYCHAIN = 'Juno could not read the Slack keychain item. Allow access when macOS asks, or sign in instead.'
export const WRONG_KEYCHAIN = 'The Slack keychain item did not unlock the session cookie. Sign in instead.'
export const UNREADABLE = 'The Slack app’s data could not be read.'

export async function readSlackApp(options: {
  readonly candidates: ReadonlyArray<SlackAppCandidate>
  /** Asked only once a signed-in team is found. Undefined when the user declined or the item is missing. */
  readonly keychainPassword: (service: string) => Promise<string | undefined>
  readonly log?: (line: string) => void
}): Promise<SlackAppRead> {
  const log = options.log ?? ((line: string) => console.info(line))
  const location = await locateSlackAppData(options.candidates)
  if (!location.found) {
    log(`main: slack import found no usable Slack data (${location.reason})`)
    return location.reason === 'not-installed'
      ? { ok: false, kind: 'no-slack-app', message: NOT_INSTALLED }
      : { ok: false, kind: 'slack-signed-out', message: SIGNED_OUT }
  }
  const { data } = location
  log(`main: slack import using ${data.variant} data, cookies at ${data.cookiesFile}`)

  const copy = await mkdtemp(join(tmpdir(), 'juno-import-'))
  try {
    await copySlackAppData(data, copy)
    const { team, cookie } = await readSlackAppSession({ dir: copy, keychainPassword: () => options.keychainPassword(data.keychainService) })
    return { ok: true, team, cookie }
  } catch (cause) {
    if (!(cause instanceof SlackAppImportError)) return { ok: false, kind: 'other', message: UNREADABLE }
    log(`main: slack import stopped (${cause.reason})`)
    switch (cause.reason) {
      case 'no-keychain':
        return { ok: false, kind: 'keychain', message: NO_KEYCHAIN }
      case 'no-cookie':
        return { ok: false, kind: 'keychain', message: WRONG_KEYCHAIN }
      case 'no-local-config':
      case 'no-team':
      case 'signed-out':
        return { ok: false, kind: 'slack-signed-out', message: SIGNED_OUT }
    }
  } finally {
    await rm(copy, { recursive: true, force: true })
  }
}
