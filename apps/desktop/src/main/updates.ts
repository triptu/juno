import { app, BrowserWindow } from 'electron'
import { Events, type UpdateState } from '@juno/contract'
import type { AppUpdater, UpdateCheckResult } from 'electron-updater'

// Replaced by electron-vite. No runtime environment override or app token.
declare const __JUNO_UPDATE_FEED_URL__: string

/** Shell-only updater. Nothing loads or contacts GitHub until the owner opts in. */
export function createUpdates(initial: boolean, save: (enabled: boolean) => void) {
  const available = app.isPackaged && process.env.JUNO_E2E !== '1' && __JUNO_UPDATE_FEED_URL__ !== ''
  let enabled = available && initial
  let state: UpdateState = available ? { kind: enabled ? 'idle' : 'disabled' } : { kind: 'unavailable' }
  let updater: AppUpdater | undefined
  let pending: UpdateCheckResult | null = null
  let checking = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const publish = (next: UpdateState) => {
    state = next
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(Events.updatesChanged, state)
  }
  const check = async () => {
    if (!enabled || checking || state.kind === 'ready') return
    checking = true
    try {
      if (!updater) {
        const module = await import('electron-updater')
        if (!enabled) return
        updater = module.autoUpdater
        updater.setFeedURL({ provider: 'generic', url: __JUNO_UPDATE_FEED_URL__ })
        updater.autoDownload = false
        updater.autoInstallOnAppQuit = false
        updater.logger = null
        updater.on('error', () => { /* Background failures stay quiet; the next check retries. */ })
        updater.on('update-downloaded', (info) => {
          if (enabled) publish({ kind: 'ready', version: info.version })
        })
      }
      pending = await updater.checkForUpdates()
      if (!enabled) pending?.cancellationToken?.cancel()
      else if (pending?.isUpdateAvailable) await updater.downloadUpdate(pending.cancellationToken)
    } catch {
      // No dialogs or notifications for a background check.
    } finally {
      checking = false
      pending = null
      if (enabled) timer = setTimeout(() => void check(), 6 * 60 * 60 * 1000)
    }
  }
  return {
    get: () => state,
    set: (on: boolean) => {
      if (!available) return state
      enabled = on
      save(on)
      clearTimeout(timer)
      if (!on) pending?.cancellationToken?.cancel()
      publish({ kind: on ? 'idle' : 'disabled' })
      if (on) void check()
      return state
    },
    start: () => { if (enabled) timer = setTimeout(() => void check(), 30_000) },
    stop: () => { enabled = false; clearTimeout(timer); pending?.cancellationToken?.cancel() },
    restart: () => { if (enabled && state.kind === 'ready') updater?.quitAndInstall() },
  }
}
export type Updates = ReturnType<typeof createUpdates>
