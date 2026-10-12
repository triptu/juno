import '@juno/tokens/fonts.css'
import './global.css'

import { acquireRendererPort, configureConnection, registry } from '@juno/state'
import { afterPaint, mark, measure, observeFrames } from '@juno/state/perf'
import { RegistryContext } from '@juno/state/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

mark('juno.start')

// The engine port comes from main through the preload; reconnects reuse this.
configureConnection(registry, { acquire: acquireRendererPort })

// Frame and input observers run always; tests and DevTools read the counters.
Object.assign(window, { __juno: { perf: observeFrames() } })

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

// One registry for the whole app, shared with code outside React (prefetch).
createRoot(container).render(
  <StrictMode>
    <RegistryContext.Provider value={registry}>
      <App />
    </RegistryContext.Provider>
  </StrictMode>,
)

afterPaint(() => measure('juno.shell-paint', 'juno.start'))
