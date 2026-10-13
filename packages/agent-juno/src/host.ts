/**
 * The AgentHost handlers Juno's engine serves to the agent (ADR 0012).
 * WP13 adds the Slack reads, the outbox sends, resolve, presence and the
 * notification gate as the group grows.
 */
import { Effect } from 'effect'
import { AGENT_HOST_PROTOCOL, AgentHostRpcs } from '@juno/agent-contract'

export const AgentHostHandlers = AgentHostRpcs.toLayer({
  'host.hello': () => Effect.succeed({ host: 'juno', protocol: AGENT_HOST_PROTOCOL }),
})
