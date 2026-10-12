/**
 * The RPC server for every route in the contract, over a `Transport`.
 *
 * `disableFatalDefects` matters: without it a defect in one handler ends the
 * whole client. With it the defect is the `Exit` of that one request and the
 * port stays open (ADR 0009).
 */
import { Layer } from 'effect'
import { RpcServer } from 'effect/rpc'
import { AllRoutes } from '@juno/contract'
import { runnerPlatform } from './runner'
import type { Transport } from './transport'

export function protocolServer(transport: Transport) {
  return RpcServer.layer(AllRoutes, { disableFatalDefects: true, disableTracing: true, spanPrefix: 'juno' }).pipe(
    Layer.provide(RpcServer.layerProtocolWorkerRunner),
    Layer.provide(runnerPlatform(transport)),
  )
}
