/**
 * The AgentHost server: the engine's side of the port main brokers to the
 * agent utility process (ADR 0012). Same runner as the renderer protocol,
 * on its own transport, serving `AgentHostRpcs` with the handlers from
 * `@juno/agent-juno` over the engine's `JunoHost` (`agent-host/`).
 *
 * `Layer.fresh` keeps this protocol apart from the renderer's: layers are
 * shared by reference within one build, so without it both servers would
 * get the first transport.
 */
import { Layer } from 'effect'
import { RpcServer } from 'effect/rpc'
import { AgentHostRpcs } from '@juno/agent-contract'
import { agentHostHandlers, type HandlerOptions } from '@juno/agent-juno'
import { runnerPlatform } from './runner'
import type { Transport } from './transport'

export function agentHostServer(transport: Transport, options: HandlerOptions) {
  return RpcServer.layer(AgentHostRpcs, { disableFatalDefects: true, disableTracing: true, spanPrefix: 'juno-agent-host' }).pipe(
    Layer.provide(agentHostHandlers(options)),
    Layer.provide(Layer.fresh(RpcServer.layerProtocolWorkerRunner)),
    Layer.provide(runnerPlatform(transport)),
  )
}
