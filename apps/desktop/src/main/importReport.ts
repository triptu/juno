/**
 * The report behind "Copy details" when the Slack app import fails, and the
 * line main logs for every import. It holds names, paths, versions, times and
 * yes/no answers only: never a cookie, token, password or message. Paths
 * under the home folder are written with `~`.
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

/** One keychain item tried, in order. */
export interface KeychainAttempt {
  readonly service: string
  readonly found: boolean
  /** Whether macOS gave the password. Undefined when the item was not found. */
  readonly allowed?: boolean
  /** Whether the password decrypted the cookie. Undefined when it was not tried. */
  readonly unlocked?: boolean
}

/** The installed Slack.app, from its `Info.plist`. */
export interface SlackBundle {
  readonly path: string
  readonly version?: string
  readonly appStore: boolean
}

export interface ImportReport {
  readonly junoVersion: string
  readonly macosVersion: string
  /** Undefined when no Slack.app was found in the usual places. */
  readonly bundle?: SlackBundle
  readonly checked: ReadonlyArray<SlackAppCheck>
  readonly chosen?: { readonly variant: SlackAppVariant; readonly cookiesFile: CookiesFile }
  readonly keychain: ReadonlyArray<KeychainAttempt>
  readonly step: ImportStep
  /** For `unreadable`: the error's class name, never its message. */
  readonly errorName?: string
}

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
}

const variantName: Record<SlackAppVariant, string> = { direct: 'direct download', 'app-store': 'App Store' }

/** The report as plain text, one fact per line. */
export function formatImportReport(report: ImportReport, home: string): string {
  const short = (path: string) => (path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)
  const lines = [
    'Juno: Slack app import',
    `Juno ${report.junoVersion}, macOS ${report.macosVersion}`,
    report.bundle === undefined
      ? 'Slack app: not found in /Applications or ~/Applications'
      : `Slack app: ${report.bundle.version ?? 'unknown version'}, ${report.bundle.appStore ? 'App Store build' : 'direct download build'}, ${short(report.bundle.path)}`,
    'Checked:',
    ...report.checked.map((check) => `  ${variantName[check.variant]}: ${short(check.dir)}: ${checkLine(check)}`),
    `Chosen: ${report.chosen === undefined ? 'none' : `${variantName[report.chosen.variant]}, ${report.chosen.cookiesFile}`}`,
    `Keychain: ${report.keychain.length === 0 ? 'not asked' : report.keychain.map(attemptLine).join('; ')}`,
    `Failed at: ${stepLine[report.step]}${report.errorName === undefined ? '' : ` (${report.errorName})`}`,
  ]
  return lines.join('\n')
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
  if (attempt.allowed !== true) return `"${attempt.service}" found, access refused`
  const unlocked = attempt.unlocked === undefined ? '' : attempt.unlocked ? ', unlocked the cookie' : ', did not unlock the cookie'
  return `"${attempt.service}" found, access allowed${unlocked}`
}
