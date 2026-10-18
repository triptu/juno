/**
 * The owner's click on a Juno Agent card, as the engine records it (decision
 * of 10-18). The renderer sends each approved child's action id and digest
 * here before it tells the agent, and the engine's AgentHost writes to Slack
 * only for a dispatch that matches an unused click. Juno Agent cannot call
 * this route: it reaches the engine only through the AgentHost port.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotSignedIn } from '../errors'

export const ApprovedChild = Schema.Struct({ actionId: Schema.String, digest: Schema.String })

export const agentWritesApprove = Rpc.make('agentWrites.approve', {
  payload: { children: Schema.Array(ApprovedChild).check(Schema.isMinLength(1), Schema.isMaxLength(20)) },
  success: Schema.Void,
  error: NotSignedIn,
})

export const AgentWritesRoutes = RpcGroup.make(agentWritesApprove)
