/**
 * Starts the renderer once its entry has chosen how to reach the engine and
 * main: `main.tsx` in Electron (the port from main, the preload's bridge),
 * the web shell's page in a browser (a WebSocket, a web bridge;
 * `apps/desktop/web/page`). Nothing here knows which.
 */
import '@juno/tokens/fonts.css'
import './global.css'

import { frequentEmojiAtom, recentEmojiAtom, registry, sidebarSectionsAtom } from '@juno/state'
import { acquireAgentPort, configureAgentConnection } from '@juno/state/agent'
import { afterPaint, measure, observeFrames } from '@juno/state/perf'
import { RegistryContext } from '@juno/state/react'
import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { TooltipLayer } from '@juno/views'
import { App } from './App'
import { clearCaretsLeftBehind } from './containers/caret'
import { tooltipDetail } from './containers/PersonStatus'
import { preloadHuddleHeader } from './containers/huddle/slots'
import { setReadingOnly } from './containers/readingOnly'

export interface RendererOptions {
  /** The read-only demo: topics, tabs and peek, and nothing that writes, searches or needs the OS (`containers/readingOnly.ts`). */
  readonly readingOnly?: boolean
}

/** Call once, after `configureConnection` (or the socket's) on the app registry. */
export function startRenderer(options: RendererOptions = {}): void {
  const reading = options.readingOnly === true
  if (reading) setReadingOnly()
  // The Juno Agent's port, through the bridge. Nothing asks for it until a Juno atom is read.
  configureAgentConnection(registry, { acquire: acquireAgentPort })

  // The sidebar's list is asked for before the first render, so its query is on its way while the
  // shell renders and lays out, not after (performance.md 4.1). The list container subscribes when it
  // mounts; this subscription ends a frame after the first rows, so a hidden sidebar holds nothing.
  let releaseSidebar: (() => void) | undefined
  // `immediate` reads the atom now; a plain subscription would not start the query until something reads it.
  releaseSidebar = registry.subscribe(
    sidebarSectionsAtom,
    (sections) => {
      if (!sections.ready || releaseSidebar === undefined) return
      // Warm picker ranking and composer recency after the first sidebar paint.
      if (!reading) afterPaint(() => { registry.mount(frequentEmojiAtom); registry.mount(recentEmojiAtom) })
      const release = releaseSidebar
      releaseSidebar = undefined
      afterPaint(release)
    },
    { immediate: true },
  )

  // Frame and input observers run always; tests and DevTools read the counters.
  Object.assign(window, { __juno: { perf: observeFrames() } })
  clearCaretsLeftBehind()

  const found = document.getElementById('root')
  if (!found) throw new Error('Missing #root element')
  const container: HTMLElement = found

  // Commit the shell before the page can paint. Waiting for the engine port or
  // React's scheduled render lets ready-to-show expose an empty window first.
  flushSync(() => {
    createRoot(container).render(
      <StrictMode>
        <RegistryContext.Provider value={registry}>
          <App />
          <TooltipLayer detail={tooltipDetail} />
        </RegistryContext.Provider>
      </StrictMode>,
    )
  })
  afterPaint(() => measure('juno.shell-paint', 'juno.start'))
  // The huddle media service starts after the first paint, as a chunk of its own; Chime loads only on join.
  if (!reading) afterPaint(() => {
    void import('./containers/huddle/media').then((module) => module.startHuddleMedia())
    preloadHuddleHeader()
  })
}
