/**
 * Finding the installed Slack app's user data (research slack-data-access
 * section 1). Two installs exist on macOS:
 *
 * - `direct`: the download from slack.com, not sandboxed, data in
 *   `~/Library/Application Support/Slack`.
 * - `app-store`: the Mac App Store build, sandboxed, data in
 *   `~/Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack`.
 *
 * Inside either, the cookie store is `Network/Cookies` on newer Chromium and
 * `Cookies` on older; Slack's own main process prefers `Network/Cookies` when
 * it exists. Both builds name the keychain item "Slack Safe Storage" (from
 * the app name; Slack's own App Store to direct migration copies the cookie
 * file across unchanged). Only file names and times are read here.
 */
import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const LOCAL_STORAGE_DIR = join('Local Storage', 'leveldb')
/** Cookie store locations inside the user data directory, in the order Slack checks them. */
export const COOKIES_FILES = [join('Network', 'Cookies'), 'Cookies'] as const
export type CookiesFile = (typeof COOKIES_FILES)[number]

export type SlackAppVariant = 'direct' | 'app-store'

export interface SlackAppCandidate {
  readonly variant: SlackAppVariant
  readonly dir: string
  /** The keychain service holding the cookie encryption password. */
  readonly keychainService: string
}

export const KEYCHAIN_SERVICE = 'Slack Safe Storage'

/** The places the Slack app keeps its data, direct download first. */
export function slackAppCandidates(home: string): ReadonlyArray<SlackAppCandidate> {
  return [
    { variant: 'direct', dir: join(home, 'Library', 'Application Support', 'Slack'), keychainService: KEYCHAIN_SERVICE },
    {
      variant: 'app-store',
      dir: join(home, 'Library', 'Containers', 'com.tinyspeck.slackmacgap', 'Data', 'Library', 'Application Support', 'Slack'),
      keychainService: KEYCHAIN_SERVICE,
    },
  ]
}

export interface SlackAppData extends SlackAppCandidate {
  readonly cookiesFile: CookiesFile
}

/** What was found at one candidate: names and times only. */
export interface SlackAppCheck {
  readonly variant: SlackAppVariant
  readonly dir: string
  readonly exists: boolean
  readonly localStorage: boolean
  readonly cookiesFile?: CookiesFile
  /** The cookie store's modification time, epoch milliseconds. */
  readonly cookiesModified?: number
}

export type SlackAppLocation =
  | { readonly found: true; readonly data: SlackAppData; readonly checked: ReadonlyArray<SlackAppCheck> }
  /** `not-installed`: no candidate directory exists. `signed-out`: one exists but lacks Local Storage or a cookie store. */
  | { readonly found: false; readonly reason: 'not-installed' | 'signed-out'; readonly checked: ReadonlyArray<SlackAppCheck> }

/**
 * The candidate with Local Storage and a cookie store. When several have
 * both, the one written most recently wins: it is the install in use.
 */
export async function locateSlackAppData(candidates: ReadonlyArray<SlackAppCandidate>): Promise<SlackAppLocation> {
  const checked: Array<SlackAppCheck> = []
  let best: { readonly data: SlackAppData; readonly modified: number } | undefined
  for (const candidate of candidates) {
    const base = { variant: candidate.variant, dir: candidate.dir }
    if ((await modifiedAt(candidate.dir)) === undefined) {
      checked.push({ ...base, exists: false, localStorage: false })
      continue
    }
    const storage = await modifiedAt(join(candidate.dir, LOCAL_STORAGE_DIR))
    const cookies = await firstCookiesFile(candidate.dir)
    checked.push({
      ...base,
      exists: true,
      localStorage: storage !== undefined,
      ...(cookies === undefined ? {} : { cookiesFile: cookies.file, cookiesModified: cookies.modified }),
    })
    if (storage === undefined || cookies === undefined) continue
    const modified = Math.max(storage, cookies.modified)
    if (best === undefined || modified > best.modified) best = { data: { ...candidate, cookiesFile: cookies.file }, modified }
  }
  if (best !== undefined) return { found: true, data: best.data, checked }
  return { found: false, reason: checked.some((check) => check.exists) ? 'signed-out' : 'not-installed', checked }
}

async function firstCookiesFile(dir: string): Promise<{ readonly file: CookiesFile; readonly modified: number } | undefined> {
  for (const file of COOKIES_FILES) {
    const modified = await modifiedAt(join(dir, file))
    if (modified !== undefined) return { file, modified }
  }
  return undefined
}

/** Copies Local Storage and the cookie store (with its journal) into `dest`, keeping their relative paths. */
export async function copySlackAppData(data: SlackAppData, dest: string): Promise<void> {
  await cp(join(data.dir, LOCAL_STORAGE_DIR), join(dest, LOCAL_STORAGE_DIR), { recursive: true })
  await mkdir(dirname(join(dest, data.cookiesFile)), { recursive: true })
  // SQLite may have a journal with the latest rows.
  for (const file of [data.cookiesFile, `${data.cookiesFile}-journal`]) {
    if ((await modifiedAt(join(data.dir, file))) !== undefined) await cp(join(data.dir, file), join(dest, file))
  }
}

async function modifiedAt(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return undefined
  }
}
