/**
 * Messages between main and the agent utility process, over
 * `process.parentPort`. The ports themselves carry `effect/rpc`.
 */
import { Schema } from 'effect'
import { HostHello } from './port'

/** What main sends the agent once, before any port. */
export const AgentConfig = Schema.Struct({
  /** The per-user agent directory: agent.sqlite, the pi journals, owner.lock. */
  agentDir: Schema.String,
  /** True under Playwright. */
  e2e: Schema.Boolean,
})
export type AgentConfig = typeof AgentConfig.Type

/** main -> agent. A `hostPort` message carries a port to the host in `ports[0]`; a new one follows every host restart. */
export const MainToAgent = Schema.Union([
  Schema.TaggedStruct('config', { config: AgentConfig }),
  Schema.TaggedStruct('hostPort', {}),
])
export type MainToAgent = typeof MainToAgent.Type

/** agent -> main. */
export const AgentToMain = Schema.Union([
  /** The agent reached its host on the current port. */
  Schema.TaggedStruct('ready', { host: HostHello }),
])
export type AgentToMain = typeof AgentToMain.Type
