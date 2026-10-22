import { RpcClient } from 'effect/rpc'
import { AgentRpcs } from '@juno/agent-contract'

/** One flattened client for every agent stream and command, owned by the atom runtime's scope. */
export const makeAgentClient = () => RpcClient.make(AgentRpcs, { flatten: true, disableTracing: true })
