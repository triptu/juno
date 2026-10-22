import '@juno/tokens/fonts.css'
import './global.css'

import { acquireRendererPort, configureConnection, frequentEmojiAtom, registry, sidebarSectionsAtom, type PortLike } from '@juno/state'
import { acquireAgentPort, configureAgentConnection } from '@juno/state/agent'
import { afterPaint, mark, measure, observeFrames } from '@juno/state/perf'
import { RegistryContext } from '@juno/state/react'
import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { TooltipLayer } from '@juno/views'
import { App } from './App'
import { clearCaretsLeftBehind } from './containers/caret'
import { preloadHuddleHeader } from './containers/huddle/slots'

mark('juno.start')

// The engine port comes from main through the preload, which asked for it as the page started.
// The first connection takes that port; reconnects ask again.
let firstPort: Promise<PortLike> | undefined = acquireRendererPort()
firstPort.catch(() => {})
configureConnection(registry, {
  acquire: () => {
    const port = firstPort ?? acquireRendererPort()
    firstPort = undefined
    return port
  },
})
// The Juno Agent's port, the same way. Nothing asks for it until a Juno atom is read.
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
    // Warm durable frequents after the first sidebar paint, before a picker needs them.
    afterPaint(() => { registry.mount(frequentEmojiAtom) })
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
        <TooltipLayer />
      </RegistryContext.Provider>
    </StrictMode>,
  )
})
afterPaint(() => measure('juno.shell-paint', 'juno.start'))
// The huddle media service starts after the first paint, as a chunk of its own; Chime loads only on join.
afterPaint(() => {
  void import('./containers/huddle/media').then((module) => module.startHuddleMedia())
  preloadHuddleHeader()
})
