/**
 * The engine's routes over WebSockets, for the web shell (`docs/development.md`,
 * "Web shell"): `effect/rpc`'s socket server protocol with JSON frames, the
 * same protocol `@juno/state/socket` speaks.
 *
 * The host owns the HTTP server and the upgrade (the shell shares one port
 * with Vite) and pushes each accepted socket in with `add`. Each socket is one
 * RPC client, as each port is: its close interrupts every fiber that belongs
 * to it. The engine never imports `ws`; a socket is typed against the
 * WHATWG surface `ws` also has.
 *
 * The only file in the engine that imports `effect/socket` and `effect/net`.
 */
import { Effect, FiberSet, Layer } from 'effect'
import { NetAddress } from 'effect/net'
import { RpcSerialization, RpcServer } from 'effect/rpc'
import { Socket, SocketServer } from 'effect/socket'

/** A source of accepted WebSockets, as `Transport` is a source of ports. */
export interface SocketTransport {
  /** Where the sockets come in, for the server's `address`. */
  readonly address: { readonly host: string; readonly port: number }
  /** Calls `attach` for every socket, now and later. Returns an unsubscribe. */
  readonly sockets: (attach: (socket: Socket.WebSocketLike) => void) => () => void
}

/** Collects sockets pushed in from the outside. The server closes those still open when the engine stops. */
export function socketTransport(address: SocketTransport['address']): SocketTransport & { readonly add: (socket: Socket.WebSocketLike) => void } {
  const listeners = new Set<(socket: Socket.WebSocketLike) => void>()
  const pending: Array<Socket.WebSocketLike> = []
  return {
    address,
    sockets: (attach) => {
      listeners.add(attach)
      for (const socket of pending.splice(0)) attach(socket)
      return () => {
        listeners.delete(attach)
      }
    },
    add: (socket) => {
      if (listeners.size === 0) pending.push(socket)
      else for (const attach of listeners) attach(socket)
    },
  }
}

/** Whether `transport` carries sockets rather than ports. */
export const isSocketTransport = (transport: object): transport is SocketTransport => 'sockets' in transport

function socketServer(transport: SocketTransport): Layer.Layer<SocketServer.SocketServer> {
  const address = NetAddress.inetAddressFromIpStringUnsafe(transport.address.host, transport.address.port)
  return Layer.succeed(SocketServer.SocketServer, {
    address,
    run: <R, E, _>(handler: (socket: Socket.Socket) => Effect.Effect<_, E, R>) =>
      Effect.gen(function* () {
        const fibers = yield* FiberSet.make()
        const fork = yield* FiberSet.runtime(fibers)<R>()
        const open = new Set<Socket.WebSocketLike>()
        const unsubscribe = transport.sockets((ws) => {
          open.add(ws)
          const socket = Socket.fromWebSocket(Effect.acquireRelease(Effect.succeed(ws), () => Effect.sync(() => ws.close(1000))))
          fork(Effect.flatMap(socket, handler).pipe(Effect.ensuring(Effect.sync(() => open.delete(ws)))))
        })
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            unsubscribe()
            for (const ws of open) ws.close(1001)
            open.clear()
          }),
        )
        return yield* Effect.never
      }).pipe(Effect.scoped),
  })
}

/** A server `Protocol` over the sockets of `transport`. */
export function socketProtocol(transport: SocketTransport): Layer.Layer<RpcServer.Protocol> {
  return RpcServer.layerProtocolSocketServer.pipe(Layer.provide(Layer.mergeAll(socketServer(transport), RpcSerialization.layerJson)))
}
