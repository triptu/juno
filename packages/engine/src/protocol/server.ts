/**
 * The RPC server for every route in the contract, over a `Transport` of ports
 * (Electron, tests) or a `SocketTransport` of WebSockets (the web shell).
 *
 * `disableFatalDefects` matters: without it a defect in one handler ends the
 * whole client. With it the defect is the `Exit` of that one request and the
 * port stays open (ADR 0009).
 */
import { Effect, Layer } from 'effect'
import { RpcServer } from 'effect/rpc'
import * as RpcMiddleware from 'effect/rpc/RpcMiddleware'
import { CommandWrite } from '@juno/store'
import { AllRoutes, liveKindOf } from '@juno/contract'
import { runnerPlatform } from './runner'
import { isSocketTransport, socketProtocol, type SocketTransport } from './socket'
import type { Transport } from './transport'

class CommandOrigin extends RpcMiddleware.Service<CommandOrigin>()('juno/engine/CommandOrigin') {}

export function protocolServer(transport: Transport | SocketTransport) {
  const protocol = isSocketTransport(transport) ? socketProtocol(transport) : RpcServer.layerProtocolWorkerRunner.pipe(Layer.provide(runnerPlatform(transport)))
  return RpcServer.layer(AllRoutes.middleware(CommandOrigin), { disableFatalDefects: true, disableTracing: true, spanPrefix: 'juno' }).pipe(
    Layer.provide(Layer.succeed(CommandOrigin, (effect, { rpc }) => liveKindOf(rpc) === undefined ? effect.pipe(Effect.provideService(CommandWrite, true)) : effect)),
    Layer.provide(protocol),
  )
}
