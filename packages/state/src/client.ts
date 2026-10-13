/**
 * The engine client: one `AtomRpc` service over the port protocol, living in
 * an atom runtime so its scope outlives any single atom (ADR 0009).
 *
 * The port connection is an atom, set per registry: the renderer sets it once
 * at start on the app registry; a test makes its own registry with
 * `makeRegistry()` and gives it a Node `MessageChannel`.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import * as AtomRpc from 'effect/reactivity/AtomRpc'
import { AllRoutes } from '@juno/contract'
import { EngineFailed, requestEngineRestart } from './port'
import { portProtocol, type PortConnection } from './transport'

/** A set of atom values. The app has one; tests make one each. */
export type Registry = AtomRegistry.AtomRegistry

export const makeRegistry = (): Registry => AtomRegistry.make()

/** Every atom in the app lives here. The renderer root provides it to React. */
export const registry: Registry = makeRegistry()

/**
 * How the renderer reaches the engine right now. `failed` means main's
 * supervisor gave up on the engine; nothing will arrive until the app restarts.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'failed'

export const connectionStateAtom = Atom.make<ConnectionState>('connecting').pipe(Atom.keepAlive)

const noConnection: PortConnection = {
  acquire: () => Promise.reject(new Error('no engine port connection configured')),
}

/** Set once by the renderer (or a test) before the first live query. */
export const portConnectionAtom = Atom.make<PortConnection>(noConnection).pipe(Atom.keepAlive)

export function configureConnection(target: Registry, connection: PortConnection): void {
  let everConnected = false
  target.set(portConnectionAtom, {
    acquire: () =>
      connection.acquire().catch((cause: unknown) => {
        if (cause instanceof EngineFailed) target.set(connectionStateAtom, 'failed')
        throw cause
      }),
    onState: (state) => {
      connection.onState?.(state)
      if (state === 'connected') everConnected = true
      target.set(connectionStateAtom, state === 'connected' ? 'connected' : everConnected ? 'reconnecting' : 'connecting')
    },
  })
}

/**
 * The sidebar's Restart after the engine failed: main starts it again, and
 * the transport, which keeps asking for a port every second, connects to it.
 */
export async function restartEngine(target: Registry): Promise<void> {
  target.set(connectionStateAtom, 'reconnecting')
  await requestEngineRestart()
}

export class EngineClient extends AtomRpc.Service<EngineClient>()('juno/state/EngineClient', {
  group: AllRoutes,
  protocol: (get) => portProtocol(get(portConnectionAtom)),
  disableTracing: true,
}) {}
