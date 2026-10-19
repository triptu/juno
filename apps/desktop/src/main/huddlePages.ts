/**
 * Huddle media generations (packages/contract/src/routes/huddle.ts): one
 * per load of a renderer page. A page's media service asks for one when it
 * starts; main gives them out in rising order, keeps one per page, and
 * tells the engine which are live and the highest given out. A page is gone
 * when its main frame commits a new document (a reload included), its
 * renderer process goes, or it is destroyed: its WebRTC is torn down with
 * it, so the engine may treat that generation's media as stopped. No
 * business logic.
 *
 * Generations start from this launch's clock in microseconds, so they rise
 * across launches too and a stored record never names a later page.
 */
import { app, BrowserWindow } from 'electron'
import type { EngineSupervisor } from './engine'

/** Call once (`registerIpc` does). Windows that never register a generation are watched to no effect. */
export function watchHuddlePages(supervisor: Pick<EngineSupervisor, 'send' | 'onReady'>) {
  const live = new Map<number, number>()
  /** The generation each page had when its main frame started to leave its document. */
  const leaving = new Map<number, number>()
  let maxIssued = Date.now() * 1000
  const report = () => supervisor.send({ _tag: 'huddlePages', live: [...live.values()], maxIssued })
  const forget = (id: number, generation?: number) => {
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
    /** Gives a page's media service its generation. A newer page of the same contents replaces the one before, which is gone by then. */
    register(contentsId: number): number {
      const generation = ++maxIssued
      live.set(contentsId, generation)
      // The engine holds back a Start from a generation above the highest it has heard of, so this report and the page's Start may come in either order.
      report()
      return generation
    },
  }
}
