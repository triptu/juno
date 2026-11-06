/**
 * Looks for a newer version, one look at a time (updates.ts): an unsigned
 * build offers its DMG, a signed build downloads it in place through
 * electron-updater. `reset` drops a look in progress, so it reports nothing
 * more. Electron and electron-updater come in through `LookerDeps`.
 */
import type { AppUpdater } from 'electron-updater'
import type { LatestRelease } from './releaseFeed'
import { compareVersions } from './releaseNotes'

/** What a look for a newer version reports, and only while its generation is current. */
export interface LookEvents {
  readonly offer: (release: LatestRelease, download: 'none' | 'downloading') => void
  readonly progress: (share: number) => void
  readonly ready: (version: string) => void
  readonly idle: () => void
}

/** What electron-updater reports while it downloads: the share done, then the version ready to install. */
export interface UpdaterEvents {
  readonly progress: (share: number) => void
  readonly downloaded: (version: string) => void
}

export type SignedUpdater = Pick<AppUpdater, 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall'>

export interface LookerDeps {
  /** Developer ID signed: the update can be installed in place. */
  readonly signed: boolean
  /** The installed version. */
  readonly version: string
  readonly latest: () => Promise<LatestRelease>
  /** electron-updater, loaded on the first signed look and kept; its download events arrive through `events`. */
  readonly load: (events: UpdaterEvents) => Promise<SignedUpdater>
}

export function createLooker(deps: LookerDeps, events: LookEvents) {
  let generation = 0
  let looking: Promise<'none' | 'found'> | undefined
  let updater: SignedUpdater | undefined
  /** The generation of the look whose download is in progress. The updater is loaded once, so its events follow this, not the look that loaded it. */
  let downloading: number | undefined
  let cancel: (() => void) | undefined
  const look = async (at: number): Promise<'none' | 'found'> => {
    const latest = await deps.latest()
    if (at !== generation || compareVersions(latest.version, deps.version) <= 0) return 'none'
    if (!deps.signed) {
      if (latest.dmg === null) throw new Error(`Release ${latest.version} has no DMG`)
      events.offer(latest, 'none')
      return 'found'
    }
    try {
      updater ??= await deps.load({
        progress: (share) => { if (downloading === generation) events.progress(share) },
        downloaded: (version) => { if (downloading === generation) events.ready(version) },
      })
      const result = at === generation ? await updater.checkForUpdates() : null
      if (at !== generation || result === null || !result.isUpdateAvailable) return 'none'
      cancel = () => result.cancellationToken?.cancel()
      downloading = at
      events.offer(latest, 'downloading')
      await updater.downloadUpdate(result.cancellationToken)
      return 'found'
    } catch (error) {
      // Squirrel.Mac refused the update or the download failed: offer the DMG instead.
      if (at !== generation) return 'none'
      if (latest.dmg === null) {
        events.idle()
        throw error
      }
      events.offer(latest, 'none')
      return 'found'
    } finally {
      cancel = undefined
    }
  }
  return {
    generation: () => generation,
    /** The look in progress, or a new one. */
    find: (): Promise<'none' | 'found'> => {
      if (looking !== undefined) return looking
      const run = look(generation).finally(() => { if (looking === run) looking = undefined })
      looking = run
      return run
    },
    reset: () => {
      generation += 1
      looking = undefined
      cancel?.()
    },
    install: () => updater?.quitAndInstall(),
  }
}
