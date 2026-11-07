import { app, BrowserWindow, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Events, type ReleaseNotes, type UpdateState } from '@juno/contract'
import type { AppUpdater } from 'electron-updater'
import { openedForTests, freePath } from './files'
import { createReleaseFeed, type LatestRelease, type UpdateConfig } from './releaseFeed'
import { compareVersions, parseChangelog } from './releaseNotes'
import { createLooker, type UpdaterEvents } from './updateLooker'

const CHECK_EVERY = 6 * 60 * 60 * 1000
/** How long a fetched changelog is reused before "What's new" asks again. */
const NOTES_FOR = 60 * 60 * 1000

type Feed = ReturnType<typeof createReleaseFeed>

/** electron-updater with the releases repository as a private GitHub feed. */
async function loadSignedUpdater(settings: UpdateConfig, events: UpdaterEvents): Promise<AppUpdater> {
  const module = await import('electron-updater')
  const { PrivateGitHubProvider } = await import('electron-updater/out/providers/PrivateGitHubProvider')
  const [owner, repo] = settings.repository.split('/')
  // A custom provider so the shipped token is used even when GH_TOKEN is set in the environment.
  class Releases extends PrivateGitHubProvider {
    constructor(options: ConstructorParameters<typeof PrivateGitHubProvider>[0], self: AppUpdater, runtime: ConstructorParameters<typeof PrivateGitHubProvider>[3]) {
      super(options, self, settings.token, runtime)
    }
  }
  const updater = module.autoUpdater
  updater.setFeedURL({ provider: 'custom', updateProvider: Releases, owner, repo, private: true } as unknown as Parameters<AppUpdater['setFeedURL']>[0])
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.logger = null
  updater.on('error', () => { /* Failures reach check() through the promises; the DMG is the fallback. */ })
  updater.on('download-progress', (info) => events.progress(info.percent / 100))
  updater.on('update-downloaded', (info) => events.downloaded(info.version))
  return updater
}

/** Saves the DMG to Downloads (in tests, a folder of the test's own) and opens it in Finder. */
async function saveDmg(feed: Feed, release: LatestRelease, e2e: boolean, onProgress: (share: number) => void): Promise<void> {
  if (release.dmg === null) throw new Error('The release has no DMG')
  const folder = e2e ? join(app.getPath('userData'), 'Downloads') : app.getPath('downloads')
  await mkdir(folder, { recursive: true })
  const path = freePath(folder, release.dmg.name)
  await feed.download(release.dmg, path, onProgress)
  if (e2e) openedForTests.push(path)
  else await shell.openPath(path)
}

/** The ten newest changelog sections, with the installed version identified for the view. */
function notesFor(text: string): ReleaseNotes {
  const entries = parseChangelog(text)
  const current = app.getVersion()
  const recent = entries.toSorted((a, b) => compareVersions(b.version, a.version)).slice(0, 10)
  return { kind: 'notes', installedVersion: current, availableVersions: recent.filter((entry) => compareVersions(entry.version, current) > 0).map((entry) => entry.version), entries: recent }
}

/** "What's new": CHANGELOG.md, fetched when first asked for and kept for an hour. */
function releaseNotes(feed: Feed | null) {
  let kept: { readonly text: string; readonly at: number } | undefined
  return async (scope: 'installed' | 'update'): Promise<ReleaseNotes> => {
    void scope
    try {
      if (feed === null) throw new Error('Updates are unavailable')
      if (kept === undefined || Date.now() - kept.at >= NOTES_FOR) kept = { text: await feed.changelog(), at: Date.now() }
      return notesFor(kept.text)
    } catch {
      return { kind: 'failed' }
    }
  }
}

/** Copy details for a failed check: the version and the error, never the token. */
function detailsOf(error: unknown, token: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return `Juno ${app.getVersion()} could not check for updates: ${message.replaceAll(token, '[token]')}`.slice(0, 500)
}

/**
 * Shell-only updater. Nothing loads or contacts GitHub until the owner opts in
 * or presses Check for updates, except "What's new", which fetches the
 * changelog when asked.
 *
 * A Developer ID signed build downloads through electron-updater and installs on
 * Restart to update. Squirrel.Mac cannot install into an unsigned build, so an
 * unsigned build only offers the new version's DMG, which the owner opens and
 * drags to Applications. A signed build falls back to the DMG too when the
 * in-place download fails.
 */
export function createUpdates(initial: boolean, save: (enabled: boolean) => void, config: UpdateConfig | null, e2e: boolean) {
  const feed = config === null ? null : createReleaseFeed(config)
  let enabled = config !== null && initial
  let state: UpdateState = config === null ? { kind: 'unavailable' } : { kind: 'idle', enabled }
  let found: LatestRelease | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const publish = (next: UpdateState) => {
    state = next
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(Events.updatesChanged, state)
  }
  const offer = (release: LatestRelease, download: 'none' | 'downloading' | 'failed', progress?: number) => {
    found = release
    publish({ kind: 'available', enabled, version: release.version, download, ...(progress === undefined ? {} : { progress }) })
  }
  /** Download progress, published in whole percents. */
  const progress = (release: LatestRelease | null, share: number) => {
    const rounded = Math.floor(share * 100) / 100
    if (release === null || found !== release || state.kind !== 'available' || state.download !== 'downloading' || state.progress === rounded) return
    offer(release, 'downloading', rounded)
  }
  const looker = config === null || feed === null ? null : createLooker({ signed: config.signed, version: app.getVersion(), latest: () => feed.latest(), load: (events) => loadSignedUpdater(config, events) }, {
    offer,
    progress: (share) => progress(found, share),
    ready: (version) => publish({ kind: 'ready', enabled, version }),
    idle: () => publish({ kind: 'idle', enabled }),
  })
  const busy = () => state.kind === 'checking' || state.kind === 'ready' || (state.kind === 'available' && state.download === 'downloading')
  const schedule = () => {
    clearTimeout(timer)
    timer = enabled ? setTimeout(background, CHECK_EVERY) : undefined
  }
  /** The automatic check: no dialogs or notifications, and a failure says nothing. */
  const background = () => {
    if (!enabled || looker === null) return
    if (busy()) return schedule()
    looker.find().catch(() => {}).finally(schedule)
  }
  return {
    get: () => state,
    set: (on: boolean) => {
      if (looker === null) return state
      enabled = on
      save(on)
      // Turning updates on keeps an update already found; turning them off drops it.
      if (on && (state.kind === 'ready' || state.kind === 'available')) publish({ ...state, enabled })
      else {
        looker.reset()
        found = null
        publish({ kind: 'idle', enabled })
      }
      schedule()
      background()
      return state
    },
    /** Check for updates: at once, with automatic updates on or off. The result arrives through `updates.changed`. */
    check: () => {
      if (looker === null || config === null || busy()) return state
      const at = looker.generation()
      publish({ kind: 'checking', enabled })
      looker.find().then(
        (result) => { if (at === looker.generation() && result === 'none') publish({ kind: 'current', enabled }) },
        (error: unknown) => { if (at === looker.generation()) publish({ kind: 'failed', enabled, details: detailsOf(error, config.token) }) },
      ).finally(schedule)
      return state
    },
    start: () => { if (enabled) timer = setTimeout(background, 30_000) },
    stop: () => { enabled = false; clearTimeout(timer); looker?.reset() },
    /** Restart to update: quits into the downloaded update, and says whether it did. */
    install: () => state.kind === 'ready' && (looker?.install() ?? false),
    /** "Download the new version". Answers at once; the state moves on through `updates.changed`. */
    download: () => {
      const release = found
      if (feed === null || release === null || state.kind !== 'available' || state.download === 'downloading') return state
      offer(release, 'downloading')
      const settle = (download: 'none' | 'failed') => () => { if (found === release) offer(release, download) }
      void saveDmg(feed, release, e2e, (share) => progress(release, share)).then(settle('none'), settle('failed'))
      return state
    },
    notes: releaseNotes(feed),
  }
}
export type Updates = ReturnType<typeof createUpdates>
