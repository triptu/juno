/**
 * The Slack app import on Windows (architecture 14), beside the Mac's in
 * `slackAppData.ts`: find the install, copy its data, read the team and the
 * `d` cookie from the copy, and build the same report.
 *
 * There is no keychain and no prompt: the cookie key is in the install's
 * `Local State`, protected with DPAPI for the Windows user (`dpapi.ts`), read
 * only once the team and a stored `d` cookie are found. Slack holds its
 * cookie database open while it runs; a copy that fails that way asks the
 * owner to quit Slack.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copySlackAppData, locateSlackAppData, readProtectedCookieKey, readSlackAppSession, SlackAppImportError, windowsCookieKey, type SlackAppCandidate } from '@juno/slack/import'
import type { Unprotect } from './dpapi'
import { formatImportReport, type CookieKeyAttempt, type ImportOutcome, type ImportStep, type SlackWindowsInstall } from './importReport'
import { errorName, failure, stepOf, type SlackAppRead } from './slackAppData'

export const NOT_INSTALLED_WINDOWS = 'Slack isn’t installed on this PC. Install Slack, sign in to it, then try again.'
export const SLACK_OPEN = 'Juno can’t read the Slack app’s data while Slack is open. Quit Slack, then try again.'
export const NO_COOKIE_KEY = 'Juno could not unlock the Slack app’s session on this PC. Open Slack, sign in there, then try again.'

export interface WindowsReadOptions {
  readonly candidates: ReadonlyArray<SlackAppCandidate>
  readonly junoVersion: string
  readonly windowsVersion: string
  /** `%LOCALAPPDATA%\\slack`, where the installer puts `app-<version>` folders. */
  readonly installDir: string
  readonly unprotect: Unprotect
  /** The home folder, written as `~` in the report. */
  readonly home: string
  readonly log?: (line: string) => void
}

export async function readWindowsSlackApp(options: WindowsReadOptions): Promise<SlackAppRead> {
  const log = options.log ?? ((line: string) => console.info(line))
  const install = await readWindowsInstall(options.installDir)
  let key: CookieKeyAttempt | undefined
  const report = (outcome: ImportOutcome): string => {
    const platform = { os: 'windows' as const, windowsVersion: options.windowsVersion, install, ...(key === undefined ? {} : { key }) }
    const text = formatImportReport({ ...platform, ...outcome, junoVersion: options.junoVersion }, options.home)
    log(`main: slack import report\n${text}`)
    return text
  }

  const location = await locateSlackAppData(options.candidates)
  if (!location.found) {
    const step = location.reason === 'not-installed' ? 'not-installed' : 'no-data-files'
    return windowsFailure(step, report({ checked: location.checked, step }))
  }
  const { data, checked } = location
  const chosen = { variant: data.variant, cookiesFile: data.cookiesFile }
  // Read only once the team and a stored `d` cookie are found, so a signed-out app reports that.
  const cookieKey = async () => {
    const blob = await readProtectedCookieKey(data.dir)
    if (blob === undefined) {
      key = 'missing'
      return undefined
    }
    const raw = options.unprotect(blob)
    if (raw === undefined) {
      key = 'refused'
      return undefined
    }
    key = 'did-not-unlock'
    return windowsCookieKey(raw)
  }

  const copy = await mkdtemp(join(tmpdir(), 'juno-import-'))
  try {
    try {
      await copySlackAppData(data, copy)
    } catch (cause) {
      if (!isBusy(cause)) throw cause
      return windowsFailure('slack-running', report({ checked, chosen, step: 'slack-running' }))
    }
    const { team, cookie } = await readSlackAppSession({ dir: copy, cookieKey })
    key = 'unlocked'
    report({ checked, chosen, step: 'ok' })
    return { ok: true, team, cookie }
  } catch (cause) {
    const step = windowsStepOf(cause, key)
    return windowsFailure(step, report({ checked, chosen, step, ...(step === 'unreadable' ? { errorName: errorName(cause) } : {}) }))
  } finally {
    await rm(copy, { recursive: true, force: true })
  }
}

/** Windows reports a file another process holds open as busy, or as a refused permission. */
function isBusy(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | undefined)?.code
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
}

function windowsStepOf(cause: unknown, key: CookieKeyAttempt | undefined): Exclude<ImportStep, 'ok'> {
  if (cause instanceof SlackAppImportError && cause.reason === 'no-keychain') return key === 'refused' ? 'key-refused' : 'key-missing'
  return stepOf(cause, [])
}

function windowsFailure(step: Exclude<ImportStep, 'ok'>, details: string): SlackAppRead {
  switch (step) {
    case 'not-installed':
      return { ok: false, kind: 'no-slack-app', message: NOT_INSTALLED_WINDOWS, details }
    case 'slack-running':
      return { ok: false, kind: 'other', message: SLACK_OPEN, details }
    case 'key-missing':
    case 'key-refused':
    case 'decrypt-failed':
      return { ok: false, kind: 'keychain', message: NO_COOKIE_KEY, details }
    default:
      return failure(step, details)
  }
}

/** The installer's newest `app-<version>` folder. A Store or MSIX install leaves none. */
async function readWindowsInstall(dir: string): Promise<SlackWindowsInstall> {
  let names: Array<string>
  try {
    names = await readdir(dir)
  } catch {
    return { dir }
  }
  const versions = names.flatMap((name) => /^app-(\d+(?:\.\d+)*)$/.exec(name)?.[1] ?? [])
  const newest = versions.toSorted((a, b) => compareVersions(b, a))[0]
  return newest === undefined ? { dir } : { dir, version: newest }
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
