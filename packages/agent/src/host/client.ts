import { Context, Layer } from 'effect'
import { RpcClient, type RpcClientError, type RpcGroup } from 'effect/rpc'
import { AgentHostRpcs } from '@juno/agent-contract'
import { hostProtocol, type HostConnection } from './port'

type Client = RpcClient.RpcClient<RpcGroup.Rpcs<typeof AgentHostRpcs>, RpcClientError.RpcClientError>

/** The host app, as the agent sees it: one RPC client on the current host port. */
export class AgentHost extends Context.Service<AgentHost, Client>()('juno/agent/AgentHost') {
  static layer(connection: HostConnection) {
    return Layer.effect(AgentHost, RpcClient.make(AgentHostRpcs)).pipe(Layer.provide(hostProtocol(connection)))
  }
}
