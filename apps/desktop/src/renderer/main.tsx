import '@juno/tokens/fonts.css'
import './global.css'

import { acquireRendererPort, configureConnection, registry, sidebarSectionsAtom, type PortLike } from '@juno/state'
import { acquireAgentPort, configureAgentConnection } from '@juno/state/agent'
import { afterPaint, mark, measure, observeFrames } from '@juno/state/perf'
import { RegistryContext } from '@juno/state/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { clearCaretsLeftBehind } from './containers/caret'

mark('juno.start')

// The engine port comes from main through the preload, which asked for it as the page started.
// The first one is taken now and the connection's first attempt uses it; reconnects ask again.
// The client holds its requests until the engine says it is ready on the port, so `firstSend`
// settles when the first batch has really gone out.
let sent: () => void = () => {}
const firstSend = new Promise<void>((resolve) => {
  sent = resolve
})
let firstPort: Promise<PortLike> | undefined = acquireRendererPort().then((port) => {
  const post = port.postMessage.bind(port)
  port.postMessage = (message) => {
    post(message)
    sent()
  }
  return port
})
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

/**
 * The shell renders once the sidebar's request has gone out: the port and
 * the engine's ready message are usually waiting already, so that is a task
 * or two, and a render started first would hold the main thread while they
 * wait behind it. The shell never waits more than `PORT_WAIT_MS` for the
 * engine.
 */
const PORT_WAIT_MS = 50
function renderShell(): void {
  // One registry for the whole app, shared with code outside React (prefetch).
  createRoot(container).render(
    <StrictMode>
      <RegistryContext.Provider value={registry}>
        <App />
      </RegistryContext.Provider>
    </StrictMode>,
  )
  afterPaint(() => measure('juno.shell-paint', 'juno.start'))
}
// The rest of the batch is sent in the same task as the first request.
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
void Promise.race([firstSend.then(nextTask), new Promise<void>((resolve) => setTimeout(resolve, PORT_WAIT_MS))]).then(renderShell)
