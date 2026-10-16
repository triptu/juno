/**
 * The Electron-free half of the Slack app import (architecture 14): find the
 * install, copy its data to a temp directory, read the team and the `d`
 * cookie from the copy, and turn each failure into the line the sign-in page
 * shows. The live files are never opened, so the Slack app may be running.
 *
 * Every import builds a report (`importReport.ts`): what was checked, what
 * was chosen, which keychain items were tried and where it stopped. Main
 * logs it at info level, and a failure carries it as `details` for "Copy
 * details". No value from the files or the keychain is ever in it.
 *
 * The keychain: "Slack Safe Storage" first. For the App Store build, when
 * that item is missing or does not unlock the cookie, the other items whose
 * account is Slack's are tried, found by their attributes, which macOS gives
 * without a prompt. Only an item that exists is ever read.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SignInFailureKind } from '@juno/contract'
import {
  copySlackAppData,
  KEYCHAIN_SERVICE,
  locateSlackAppData,
  readSlackAppSession,
  SlackAppImportError,
  type LocalConfigTeam,
  type SlackAppCandidate,
  type SlackCookie,
} from '@juno/slack/import'
import { formatImportReport, type ImportReport, type ImportStep, type KeychainAttempt, type SlackBundle } from './importReport'
import type { SecurityRunner } from './keychain'

export type SlackAppRead =
  | { readonly ok: true; readonly team: LocalConfigTeam; readonly cookie: SlackCookie }
  | { readonly ok: false; readonly kind: SignInFailureKind; readonly message: string; readonly details: string }

export const NOT_INSTALLED = 'Slack isn’t installed on this Mac.'
export const SIGNED_OUT = 'Slack is installed but not signed in. Sign in to Slack in its app first, or use Sign in to Slack.'
export const NO_KEYCHAIN = 'Juno could not read the Slack keychain item. Allow access when macOS asks, or sign in instead.'
export const WRONG_KEYCHAIN = 'The Slack keychain item did not unlock the session cookie. Sign in instead.'
export const UNREADABLE = 'The Slack app’s data could not be read.'

/** Account names Slack's keychain item may have: the app name, and the App Store bundle id. */
const SLACK_ACCOUNTS = ['Slack', 'com.tinyspeck.slackmacgap']
/** Electron's name for the item if the App Store build's app name were its bundle id. */
const BUNDLE_ID_SERVICE = 'com.tinyspeck.slackmacgap Safe Storage'

/** The keychain as the import needs it. Only `read` returns a secret, and only `read` may make macOS ask. */
export interface SlackKeychain {
  /** Whether a generic password with this service exists, from its attributes. */
  readonly exists: (service: string) => Promise<boolean>
  /** The services of generic passwords with this account. */
  readonly servicesFor: (account: string) => Promise<ReadonlyArray<string>>
  /** The password, or undefined when macOS refused. */
  readonly read: (service: string) => Promise<string | undefined>
}

/** The login keychain through `/usr/bin/security`. `find-generic-password` without `-w` prints attributes only. */
export function securityKeychain(run: SecurityRunner): SlackKeychain {
  return {
    exists: async (service) => (await run(['find-generic-password', '-s', service])).code === 0,
    servicesFor: async (account) => {
      const answer = await run(['find-generic-password', '-a', account])
      if (answer.code !== 0) return []
      const service = /"svce"<blob>="([^"]*)"/.exec(answer.stdout)?.[1]
      return service === undefined ? [] : [service]
    },
    read: async (service) => {
      const answer = await run(['find-generic-password', '-w', '-s', service])
      const password = answer.stdout.replace(/\n$/, '')
      return answer.code === 0 && password !== '' ? password : undefined
    },
  }
}

/** A keychain holding one "Slack Safe Storage" item. Tests only. */
export function fixedKeychain(password: string): SlackKeychain {
  return {
    exists: async (service) => service === KEYCHAIN_SERVICE,
    servicesFor: async () => [],
    read: async (service) => (service === KEYCHAIN_SERVICE ? password : undefined),
  }
}

export interface ReadSlackAppOptions {
  readonly candidates: ReadonlyArray<SlackAppCandidate>
  readonly keychain: SlackKeychain
  /** Where Slack.app may be installed, in order. */
  readonly bundles: ReadonlyArray<string>
  readonly junoVersion: string
  readonly macosVersion: string
  /** The home folder, written as `~` in the report. */
  readonly home: string
  readonly log?: (line: string) => void
}

export async function readSlackApp(options: ReadSlackAppOptions): Promise<SlackAppRead> {
  const log = options.log ?? ((line: string) => console.info(line))
  const bundle = await readSlackBundle(options.bundles)
  const keychain: Array<KeychainAttempt> = []
  const base = { junoVersion: options.junoVersion, macosVersion: options.macosVersion, ...(bundle === undefined ? {} : { bundle }), keychain }
  const finish = (report: ImportReport): string => {
    const text = formatImportReport(report, options.home)
    log(`main: slack import report\n${text}`)
    return text
  }

  const location = await locateSlackAppData(options.candidates)
  if (!location.found) {
    const step = location.reason === 'not-installed' ? 'not-installed' : 'no-data-files'
    const details = finish({ ...base, checked: location.checked, step })
    return failure(step, details)
  }
  const { data, checked } = location
  const chosen = { variant: data.variant, cookiesFile: data.cookiesFile }

  const services = data.variant === 'app-store' ? await appStoreServices(options.keychain, data.keychainService) : [data.keychainService]
  let next = 0
  const password = async (attempt: number): Promise<string | undefined> => {
    // A later attempt means the one before did not unlock the cookie.
    if (attempt > 0) markLast(keychain, false)
    while (next < services.length) {
      const service = services[next++]!
      if (!(await options.keychain.exists(service))) {
        keychain.push({ service, found: false })
        continue
      }
      const value = await options.keychain.read(service)
      keychain.push({ service, found: true, allowed: value !== undefined })
      // The user said no: asking again for another item would be a second prompt they did not want.
      if (value === undefined) {
        next = services.length
        return undefined
      }
      return value
    }
    return undefined
  }

  const copy = await mkdtemp(join(tmpdir(), 'juno-import-'))
  try {
    await copySlackAppData(data, copy)
    const { team, cookie } = await readSlackAppSession({ dir: copy, keychainPassword: password })
    markLast(keychain, true)
    finish({ ...base, checked, chosen, step: 'ok' })
    return { ok: true, team, cookie }
  } catch (cause) {
    const step = stepOf(cause, keychain)
    const details = finish({ ...base, checked, chosen, step, ...(step === 'unreadable' ? { errorName: errorName(cause) } : {}) })
    return failure(step, details)
  } finally {
    await rm(copy, { recursive: true, force: true })
  }
}

function failure(step: Exclude<ImportStep, 'ok'>, details: string): SlackAppRead {
  switch (step) {
    case 'not-installed':
      return { ok: false, kind: 'no-slack-app', message: NOT_INSTALLED, details }
    case 'no-data-files':
    case 'no-local-config':
    case 'no-team':
    case 'no-token':
    case 'no-session-cookie':
      return { ok: false, kind: 'slack-signed-out', message: SIGNED_OUT, details }
    case 'keychain-refused':
    case 'keychain-missing':
      return { ok: false, kind: 'keychain', message: NO_KEYCHAIN, details }
    case 'decrypt-failed':
      return { ok: false, kind: 'keychain', message: WRONG_KEYCHAIN, details }
    case 'unreadable':
      return { ok: false, kind: 'other', message: UNREADABLE, details }
  }
}

function stepOf(cause: unknown, keychain: ReadonlyArray<KeychainAttempt>): Exclude<ImportStep, 'ok'> {
  if (!(cause instanceof SlackAppImportError)) return 'unreadable'
  switch (cause.reason) {
    case 'no-local-config':
      return 'no-local-config'
    case 'no-team':
      return 'no-team'
    case 'no-token':
      return 'no-token'
    case 'signed-out':
      return 'no-session-cookie'
    case 'no-keychain':
      return keychain.some((attempt) => attempt.found) ? 'keychain-refused' : 'keychain-missing'
    case 'no-cookie':
      return 'decrypt-failed'
  }
}

/** Records whether the last password given unlocked the cookie. */
function markLast(keychain: Array<KeychainAttempt>, unlocked: boolean): void {
  const index = keychain.findLastIndex((attempt) => attempt.allowed === true && attempt.unlocked === undefined)
  if (index >= 0) keychain[index] = { ...keychain[index]!, unlocked }
}

/** "Slack Safe Storage", then the other items with Slack's account names, then the bundle id's name. */
async function appStoreServices(keychain: SlackKeychain, primary: string): Promise<ReadonlyArray<string>> {
  const found = await Promise.all(SLACK_ACCOUNTS.map((account) => keychain.servicesFor(account)))
  return [...new Set([primary, ...found.flat(), BUNDLE_ID_SERVICE])]
}

/** The first Slack.app found: its version from `Info.plist`, and whether it carries an App Store receipt. */
async function readSlackBundle(paths: ReadonlyArray<string>): Promise<SlackBundle | undefined> {
  for (const path of paths) {
    let plist: string
    try {
      plist = await readFile(join(path, 'Contents', 'Info.plist'), 'utf8')
    } catch {
      continue
    }
    // Slack ships an XML plist; a binary one leaves the version unknown.
    const version = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1]
    return { path, ...(version === undefined ? {} : { version }), appStore: existsSync(join(path, 'Contents', '_MASReceipt')) }
  }
  return undefined
}

function errorName(cause: unknown): string {
  return cause instanceof Error ? cause.name : typeof cause
}
