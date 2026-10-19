/**
 * Huddle media generations (packages/contract/src/routes/huddle.ts): one
 * per load of a renderer page. A page's media service makes one when it
 * starts and registers it here; main keeps one per page and tells the
 * engine which are live. A page is gone when its main frame commits a new
 * document (a reload included), its renderer process goes, or it is
 * destroyed: its WebRTC is torn down with it, so the engine may treat that
 * generation's media as stopped. No business logic.
 */
import { app, BrowserWindow } from 'electron'
import type { EngineSupervisor } from './engine'

/** Call once (`registerIpc` does). Windows that never register a generation are watched to no effect. */
export function watchHuddlePages(supervisor: Pick<EngineSupervisor, 'send' | 'onReady'>) {
  const live = new Map<number, string>()
  /** The generation each page had when its main frame started to leave its document. */
  const leaving = new Map<number, string>()
  const report = () => supervisor.send({ _tag: 'huddlePages', live: [...live.values()] })
  const forget = (id: number, generation?: string) => {
    if (live.has(id) && (generation === undefined || live.get(id) === generation)) {
      live.delete(id)
      report()
    }
  }
  // A new engine process hears them at its `ready`.
  supervisor.onReady(report)
  const watch = (window: BrowserWindow): void => {
    const contents = window.webContents
    const id = contents.id
    contents.on('did-start-navigation', (details) => {
      const generation = live.get(id)
      if (details.isMainFrame && !details.isSameDocument && generation !== undefined) leaving.set(id, generation)
    })
    // Only the generation of the document that left: the new page may have registered already.
    contents.on('did-navigate', () => {
      const generation = leaving.get(id)
      leaving.delete(id)
      if (generation !== undefined) forget(id, generation)
    })
    contents.on('render-process-gone', () => forget(id))
    contents.on('destroyed', () => forget(id))
  }
  for (const window of BrowserWindow.getAllWindows()) watch(window)
  app.on('browser-window-created', (_event, window) => watch(window))
  return {
    /** A page's media service registered `generation`. A newer page of the same contents replaces the one before, which is gone by then. */
    register(contentsId: number, generation: string): void {
      live.set(contentsId, generation)
      // Before the page has its answer, so the engine hears of a generation no later than the page can use it.
      report()
    },
  }
}
