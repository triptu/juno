/**
 * The AgentHost port: what the host app (Juno's engine) offers the agent.
 *
 * The agent is the client and the host serves the group, over a MessagePort
 * that main brokers between the two utility processes (ADR 0012). WP6 adds
 * the Slack reads, sends, resolve, presence and the notification gate here.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

/** Bumped when a change to this group breaks an older agent or host. */
export const AGENT_HOST_PROTOCOL = 1

export const HostHello = Schema.Struct({
  /** Which app hosts the agent. Juno's engine answers "juno". */
  host: Schema.String,
  protocol: Schema.Int,
})
export type HostHello = typeof HostHello.Type

/** The first call on a new port. The agent checks `protocol` before using the port. */
export const hostHello = Rpc.make('host.hello', {
  payload: { protocol: Schema.Int },
  success: HostHello,
})

export const AgentHostRpcs = RpcGroup.make(hostHello)
