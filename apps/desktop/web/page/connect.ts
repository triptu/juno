/**
 * The page's engine connection: the same routes as in Electron, over a
 * WebSocket to the host on the page's own origin. `./install` comes first:
 * `@juno/state` reads the launch preferences and the bridge as it loads.
 */
import './install'
import { configureSocketConnection } from '@juno/state/socket'
import { connectionStateAtom, registry, type ConnectionState } from '@juno/state'
import { ENGINE_SOCKET_PATH } from '../paths'

/** What the page tells a test or an agent through `window.__junoWeb`. */
export interface WebPageHandle {
  /** The engine connection as the renderer sees it. */
  readonly connection: () => ConnectionState
}

export function connectToEngine(): void {
  configureSocketConnection(registry, `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${ENGINE_SOCKET_PATH}`)
  const handle: WebPageHandle = { connection: () => registry.get(connectionStateAtom) }
  Object.assign(window, { __junoWeb: handle })
}
