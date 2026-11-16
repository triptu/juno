/**
 * The report behind "Copy details" when the Slack app import fails, and the
 * line main logs for every import. It holds names, paths, versions, times and
 * yes/no answers only: never a cookie, token, password or message. Paths
 * under the home folder are written with `~`.
 *
 * On Windows there is no keychain: the report names the Windows version, the
 * installer's app folder, and what happened to the cookie key in `Local State`.
 */
import type { CookiesFile, SlackAppCheck, SlackAppVariant } from '@juno/slack/import'

/** Where the import stopped, or `ok`. */
export type ImportStep =
  | 'ok'
  | 'not-installed'
  | 'no-data-files'
  | 'no-local-config'
  | 'no-team'
  | 'no-token'
  | 'no-session-cookie'
  | 'keychain-refused'
  | 'keychain-missing'
  | 'decrypt-failed'
  | 'unreadable'
  /** Windows: no cookie key in `Local State`. */
  | 'key-missing'
  /** Windows: DPAPI did not give the cookie key back. */
  | 'key-refused'
  /** Every `d` cookie uses Chromium's app-bound (`v20`) encryption. */
  | 'app-bound'
  /** Windows: Slack holds its cookie file open, so it could not be copied. */
  | 'slack-running'

/** One keychain item tried, in order. */
export interface KeychainAttempt {
  readonly service: string
  readonly found: boolean
  /** Whether macOS gave the password. Undefined when the item was not found or not asked for. */
  readonly allowed?: boolean
  /** The password macOS gave earlier in this run, used without asking again. */
  readonly remembered?: boolean
  /** Whether the password decrypted the cookie. Undefined when it was not tried. */
  readonly unlocked?: boolean
}

/** The installed Slack.app, from its `Info.plist`. */
export interface SlackBundle {
  readonly path: string
  readonly version?: string
  readonly appStore: boolean
}

/** Windows: the installer's app folder, `%LOCALAPPDATA%\slack`, and its newest `app-<version>`. */
export interface SlackWindowsInstall {
  readonly dir: string
  /** Undefined when the folder holds no app version, as with a Store or MSIX install. */
  readonly version?: string
}

/** Windows: what happened to the cookie key in `Local State`. Undefined when it was not needed. */
export type CookieKeyAttempt = 'missing' | 'refused' | 'unlocked' | 'did-not-unlock'

export type ImportPlatform =
  | { readonly os: 'mac'; readonly macosVersion: string; readonly bundle?: SlackBundle; readonly keychain: ReadonlyArray<KeychainAttempt> }
  | { readonly os: 'windows'; readonly windowsVersion: string; readonly install: SlackWindowsInstall; readonly key?: CookieKeyAttempt }

/** What the import found and where it stopped, the same on both platforms. */
export interface ImportOutcome {
  readonly checked: ReadonlyArray<SlackAppCheck>
  readonly chosen?: { readonly variant: SlackAppVariant; readonly cookiesFile: CookiesFile }
  readonly step: ImportStep
  /** For `unreadable`: the error's class name, never its message. */
  readonly errorName?: string
}

export type ImportReport = ImportPlatform & ImportOutcome & { readonly junoVersion: string }

const stepLine: Record<ImportStep, string> = {
  ok: 'none, the session was read',
  'not-installed': 'no install: no Slack data folder exists',
  'no-data-files': 'signed out: a Slack data folder has no Local Storage or no cookie database',
  'no-local-config': 'no team in localConfig: Local Storage has no localConfig_v2',
  'no-team': 'no team in localConfig: localConfig_v2 lists no teams',
  'no-token': 'token missing: no team in localConfig_v2 has a session token',
  'no-session-cookie': 'signed out: the cookie database has no d cookie',
  'keychain-refused': 'keychain denied: macOS did not give the password',
  'keychain-missing': 'keychain missing: no Slack keychain item was found',
  'decrypt-failed': 'cookie decrypt failed: no keychain password unlocked the d cookie',
  unreadable: 'the Slack data could not be read',
  'key-missing': 'key missing: Local State has no cookie key',
  'key-refused': 'key locked: Windows did not unprotect the cookie key',
  'app-bound': 'app-bound: the d cookie uses v20 encryption, which Juno cannot read',
  'slack-running': 'Slack is open: its cookie database could not be copied',
}

/** Windows words where the Mac's name the keychain. */
const windowsStepLine: Partial<Record<ImportStep, string>> = {
  'decrypt-failed': 'cookie decrypt failed: the Local State key did not unlock the d cookie',
}

const variantName: Record<SlackAppVariant, string> = {
  direct: 'direct download',
  'app-store': 'App Store',
  msix: 'MSIX',
  'microsoft-store': 'Microsoft Store',
}

const keyLine: Record<CookieKeyAttempt, string> = {
  missing: 'not found in Local State',
  refused: 'found in Local State, Windows did not unprotect it',
  unlocked: 'found in Local State, unlocked the cookie',
  'did-not-unlock': 'found in Local State, did not unlock the cookie',
}

/** The report as plain text, one fact per line. */
export function formatImportReport(report: ImportReport, home: string): string {
  const short = (path: string) =>
    path === home || path.startsWith(`${home}/`) || path.startsWith(`${home}\\`) ? `~${path.slice(home.length)}` : path
  const step = (report.os === 'windows' ? windowsStepLine[report.step] : undefined) ?? stepLine[report.step]
  const [system, app, key] = platformLines(report, short)
  const lines = [
    'Juno: Slack app import',
    system,
    app,
    'Checked:',
    ...report.checked.map((check) => `  ${variantName[check.variant]}: ${short(check.dir)}: ${checkLine(check)}`),
    `Chosen: ${report.chosen === undefined ? 'none' : `${variantName[report.chosen.variant]}, ${report.chosen.cookiesFile}`}`,
    key,
    `Failed at: ${step}${report.errorName === undefined ? '' : ` (${report.errorName})`}`,
  ]
  return lines.join('\n')
}

/** The system line, the Slack app line, and the keychain or cookie key line. */
function platformLines(report: ImportReport, short: (path: string) => string): readonly [string, string, string] {
  if (report.os === 'windows') {
    return [
      `Juno ${report.junoVersion}, Windows ${report.windowsVersion}`,
      report.install.version === undefined
        ? `Slack app: no installer build in ${short(report.install.dir)}`
        : `Slack app: ${report.install.version}, installer build, ${short(report.install.dir)}`,
      `Cookie key: ${report.key === undefined ? 'not needed' : keyLine[report.key]}`,
    ]
  }
  return [
    `Juno ${report.junoVersion}, macOS ${report.macosVersion}`,
    report.bundle === undefined
      ? 'Slack app: not found in /Applications or ~/Applications'
      : `Slack app: ${report.bundle.version ?? 'unknown version'}, ${report.bundle.appStore ? 'App Store build' : 'direct download build'}, ${short(report.bundle.path)}`,
    `Keychain: ${report.keychain.length === 0 ? 'not asked' : report.keychain.map(attemptLine).join('; ')}`,
  ]
}

function checkLine(check: SlackAppCheck): string {
  if (!check.exists) return 'not found'
  const cookies =
    check.cookiesFile === undefined
      ? 'no cookie database'
      : `cookies at ${check.cookiesFile}${check.cookiesModified === undefined ? '' : `, modified ${new Date(check.cookiesModified).toISOString()}`}`
  return `exists, Local Storage ${check.localStorage ? 'yes' : 'no'}, ${cookies}`
}

function attemptLine(attempt: KeychainAttempt): string {
  if (!attempt.found) return `"${attempt.service}" not found`
  if (attempt.allowed === undefined) return `"${attempt.service}" found, left for the next try`
  if (!attempt.allowed) return `"${attempt.service}" found, access refused`
  const unlocked = attempt.unlocked === undefined ? '' : attempt.unlocked ? ', unlocked the cookie' : ', did not unlock the cookie'
  return `"${attempt.service}" found, ${attempt.remembered === true ? 'allowed earlier in this run' : 'access allowed'}${unlocked}`
}
