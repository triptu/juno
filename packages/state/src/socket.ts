/**
 * The web shell's way to the engine (`docs/development.md`, "Web shell"): the
 * same routes over one WebSocket, with `effect/rpc`'s own socket protocol and
 * JSON frames, in place of the port from main.
 *
 * Reconnects as the port does: when the socket drops, in-flight requests fail
 * with `RpcClientError`, live query atoms retry, and the protocol dials again
 * with backoff, so an engine that comes back needs no page reload. The
 * connection state follows the socket's opens and closes.
 *
 * The only file that imports `effect/socket` on the client side, and only the
 * web shell's page imports it, so it never reaches the Electron bundle.
 */
import { Effect, Layer } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'
import { connectionReporter, engineProtocolAtom, type Registry } from './client'
import type { EngineProtocol } from './transport'

function socketProtocol(url: string, onState: (state: 'connected' | 'disconnected') => void): EngineProtocol {
  const hooks = Layer.succeed(RpcClient.ConnectionHooks, {
    onConnect: Effect.sync(() => onState('connected')),
    onDisconnect: Effect.sync(() => onState('disconnected')),
  })
  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Layer.mergeAll(Socket.layerWebSocket(url).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)), RpcSerialization.layerJson, hooks)),
  )
}

/** The engine over the WebSocket at `url` (`ws:` or `wss:`). */
export function configureSocketConnection(target: Registry, url: string): void {
  target.set(engineProtocolAtom, socketProtocol(url, connectionReporter(target)))
}
