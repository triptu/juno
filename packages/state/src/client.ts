/**
 * The engine client: one `AtomRpc` service over the port protocol, living in
 * an atom runtime so its scope outlives any single atom (ADR 0009).
 *
 * The port connection is an atom so tests can replace it with a Node
 * `MessageChannel` through the registry; the renderer sets it once at start.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import * as AtomRpc from 'effect/reactivity/AtomRpc'
import { AllRoutes } from '@juno/contract'
import { portProtocol, type PortConnection } from './transport'

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting'

/** Every atom in the app lives here. The renderer root provides it to React. */
export const registry = AtomRegistry.make()

/** How the renderer reaches the engine right now. */
export const connectionStateAtom = Atom.make<ConnectionState>('connecting').pipe(Atom.keepAlive)

const noConnection: PortConnection = {
  acquire: () => Promise.reject(new Error('no engine port connection configured')),
}

/** Set once by the renderer (or a test) before the first live query. */
export const portConnectionAtom = Atom.make<PortConnection>(noConnection).pipe(Atom.keepAlive)

export function configureConnection(connection: PortConnection): void {
  let everConnected = false
  registry.set(portConnectionAtom, {
    acquire: connection.acquire,
    onState: (state) => {
      connection.onState?.(state)
      if (state === 'connected') everConnected = true
      registry.set(connectionStateAtom, state === 'connected' ? 'connected' : everConnected ? 'reconnecting' : 'connecting')
    },
  })
}

export class EngineClient extends AtomRpc.Service<EngineClient>()('juno/state/EngineClient', {
  group: AllRoutes,
  protocol: (get) => portProtocol(get(portConnectionAtom)),
  disableTracing: true,
}) {}
