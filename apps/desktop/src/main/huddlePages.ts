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
 * Generations start from this launch's clock in microseconds and rise by
 * one within the launch.
 */
import { app, BrowserWindow } from 'electron'
import { createHuddlePageRegistry } from './huddlePageRegistry'
import type { EngineSupervisor } from './engine'

/** Call once (`registerIpc` does). Windows that never register a generation are watched to no effect. */
export function watchHuddlePages(supervisor: Pick<EngineSupervisor, 'send' | 'onReady'>) {
  const registry = createHuddlePageRegistry((message) => supervisor.send(message))
  const leaving = new Map<number, number>()
  supervisor.onReady(registry.report)
  const watch = (window: BrowserWindow): void => {
    const contents = window.webContents
    const id = contents.id
    contents.on('did-start-navigation', (details) => {
      const generation = registry.generation(id)
      if (details.isMainFrame && !details.isSameDocument && generation !== undefined) leaving.set(id, generation)
    })
    // Only the generation of the document that left: the new page may have registered already.
    contents.on('did-navigate', () => {
      const generation = leaving.get(id)
      leaving.delete(id)
      if (generation !== undefined) registry.forget(id, generation)
    })
    contents.on('render-process-gone', () => registry.forget(id))
    contents.on('destroyed', () => registry.forget(id))
  }
  for (const window of BrowserWindow.getAllWindows()) watch(window)
  app.on('browser-window-created', (_event, window) => watch(window))
  return { register: registry.register }
}
