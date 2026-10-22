import { acquireRendererPort, configureConnection, registry, type PortLike } from '@juno/state'
import { mark } from '@juno/state/perf'
import { startRenderer } from './start'

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
startRenderer()
