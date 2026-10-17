import { app, BrowserWindow, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Events, type ReleaseNotes, type UpdateState } from '@juno/contract'
import type { AppUpdater } from 'electron-updater'
import { openedForTests, freePath } from './files'
import { createReleaseFeed, type LatestRelease, type UpdateConfig } from './releaseFeed'
import { compareVersions, notesBetween, parseChangelog } from './releaseNotes'

const CHECK_EVERY = 6 * 60 * 60 * 1000
/** How long a fetched changelog is reused before "What's new" asks again. */
const NOTES_FOR = 60 * 60 * 1000

type Feed = ReturnType<typeof createReleaseFeed>

/** electron-updater with the releases repository as a private GitHub feed. */
async function loadSignedUpdater(settings: UpdateConfig, onDownloaded: (version: string) => void): Promise<AppUpdater> {
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
  updater.on('error', () => { /* Background failures stay quiet; check() falls back to the DMG. */ })
  updater.on('update-downloaded', (info) => onDownloaded(info.version))
  return updater
}

/** Saves the DMG to Downloads (in tests, a folder of the test's own) and opens it in Finder. */
async function saveDmg(feed: Feed, release: LatestRelease, e2e: boolean): Promise<void> {
  if (release.dmg === null) throw new Error('The release has no DMG')
  const folder = e2e ? join(app.getPath('userData'), 'Downloads') : app.getPath('downloads')
  await mkdir(folder, { recursive: true })
  const path = freePath(folder, release.dmg.name)
  await feed.download(release.dmg, path)
  if (e2e) openedForTests.push(path)
  else await shell.openPath(path)
}

/** CHANGELOG.md, fetched when first asked for and kept for an hour. */
function cachedChangelog(feed: Feed | null) {
  let kept: { readonly text: string; readonly at: number } | undefined
  return async (): Promise<string> => {
    if (feed === null) throw new Error('Updates are unavailable')
    if (kept !== undefined && Date.now() - kept.at < NOTES_FOR) return kept.text
    kept = { text: await feed.changelog(), at: Date.now() }
    return kept.text
  }
}

/** "What's new" for the installed version, or for every version up to the offered one. */
function notesFor(text: string, scope: 'installed' | 'update', pending: string | null): ReleaseNotes {
  const entries = parseChangelog(text)
  const current = app.getVersion()
  if (scope === 'installed') return { kind: 'notes', entries: entries.filter((entry) => compareVersions(entry.version, current) === 0) }
  return { kind: 'notes', entries: pending === null ? [] : notesBetween(entries, current, pending) }
}

/**
 * Shell-only updater. Nothing loads or contacts GitHub until the owner opts in,
 * except "What's new", which fetches the changelog when asked.
 *
 * A Developer ID signed build downloads through electron-updater and installs on
 * Restart to update. Squirrel.Mac cannot install into an unsigned build, so an
 * unsigned build only offers the new version's DMG, which the owner opens and
 * drags to Applications. A signed build falls back to the DMG too when the
 * in-place download fails.
 */
export function createUpdates(initial: boolean, save: (enabled: boolean) => void, config: UpdateConfig | null, e2e: boolean) {
  const available = config !== null
  const feed = config === null ? null : createReleaseFeed(config)
  let enabled = available && initial
  let state: UpdateState = available ? { kind: enabled ? 'idle' : 'disabled' } : { kind: 'unavailable' }
  let updater: AppUpdater | undefined
  let found: LatestRelease | null = null
  let checking = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel: (() => void) | undefined
  const changelog = cachedChangelog(feed)
  const publish = (next: UpdateState) => {
    state = next
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(Events.updatesChanged, state)
  }
  const offer = (release: LatestRelease, download: 'none' | 'downloading' | 'failed') => {
    found = release
    if (enabled) publish({ kind: 'available', version: release.version, download })
  }
  const check = async () => {
    if (!enabled || checking || feed === null || config === null || state.kind === 'ready') return
    if (state.kind === 'available' && state.download === 'downloading') return
    checking = true
    try {
      const latest = await feed.latest()
      if (!enabled || compareVersions(latest.version, app.getVersion()) <= 0) return
      if (!config.signed) return latest.dmg === null ? undefined : offer(latest, 'none')
      try {
        updater ??= await loadSignedUpdater(config, (version) => { if (enabled) publish({ kind: 'ready', version }) })
        const result = enabled ? await updater.checkForUpdates() : null
        cancel = () => result?.cancellationToken?.cancel()
        if (enabled && result?.isUpdateAvailable) await updater.downloadUpdate(result.cancellationToken)
      } catch {
        // Squirrel.Mac refused the update or the download failed: offer the DMG instead.
        if (latest.dmg !== null) offer(latest, 'none')
      }
    } catch {
      // No dialogs or notifications for a background check.
    } finally {
      checking = false
      cancel = undefined
      clearTimeout(timer)
      if (enabled) timer = setTimeout(() => void check(), CHECK_EVERY)
    }
  }
  return {
    get: () => state,
    set: (on: boolean) => {
      if (!available) return state
      enabled = on
      found = null
      save(on)
      clearTimeout(timer)
      if (!on) cancel?.()
      publish({ kind: on ? 'idle' : 'disabled' })
      if (on) void check()
      return state
    },
    start: () => { if (enabled) timer = setTimeout(() => void check(), 30_000) },
    stop: () => { enabled = false; clearTimeout(timer); cancel?.() },
    restart: () => { if (enabled && state.kind === 'ready') updater?.quitAndInstall() },
    /** "Download the new version". Answers at once; the state moves on through `updates.changed`. */
    download: () => {
      const release = found
      if (feed === null || release === null || state.kind !== 'available' || state.download === 'downloading') return state
      offer(release, 'downloading')
      const settle = (download: 'none' | 'failed') => () => { if (found === release) offer(release, download) }
      void saveDmg(feed, release, e2e).then(settle('none'), settle('failed'))
      return state
    },
    notes: async (scope: 'installed' | 'update'): Promise<ReleaseNotes> => {
      try {
        return notesFor(await changelog(), scope, state.kind === 'ready' || state.kind === 'available' ? state.version : null)
      } catch {
        return { kind: 'failed' }
      }
    },
  }
}
export type Updates = ReturnType<typeof createUpdates>
