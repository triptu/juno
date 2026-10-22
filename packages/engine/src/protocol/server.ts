/**
 * The RPC server for every route in the contract, over a `Transport`.
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
import type { Transport } from './transport'

class CommandOrigin extends RpcMiddleware.Service<CommandOrigin>()('juno/engine/CommandOrigin') {}

export function protocolServer(transport: Transport) {
  return RpcServer.layer(AllRoutes.middleware(CommandOrigin), { disableFatalDefects: true, disableTracing: true, spanPrefix: 'juno' }).pipe(
    Layer.provide(Layer.succeed(CommandOrigin, (effect, { rpc }) => liveKindOf(rpc) === undefined ? effect.pipe(Effect.provideService(CommandWrite, true)) : effect)),
    Layer.provide(RpcServer.layerProtocolWorkerRunner),
    Layer.provide(runnerPlatform(transport)),
  )
}
