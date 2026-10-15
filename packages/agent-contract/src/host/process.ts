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
  /** Under Playwright only: the fake OpenRouter's origin, for the catalogue and the models. */
  openRouterOrigin: Schema.optionalKey(Schema.String),
})
export type AgentConfig = typeof AgentConfig.Type

/**
 * main -> agent. A `hostPort` message carries a port to the host in
 * `ports[0]`; a new one follows every host restart. A `rendererPort` carries
 * a port to one renderer, for the agent's RPCs (`AgentRpcs`). `openRouterKey`
 * is the key main holds (the keychain's, or `OPENROUTER_API_KEY` in
 * development), sent once it is loaded and again on every change from
 * Settings › Juno; the agent keeps it in memory. `null` when there is none.
 */
export const MainToAgent = Schema.Union([
  Schema.TaggedStruct('config', { config: AgentConfig }),
  Schema.TaggedStruct('hostPort', {}),
  Schema.TaggedStruct('rendererPort', {}),
  Schema.TaggedStruct('openRouterKey', { key: Schema.NullOr(Schema.String) }),
])
export type MainToAgent = typeof MainToAgent.Type

/** agent -> main. */
export const AgentToMain = Schema.Union([
  /** The agent reached its host on the current port. */
  Schema.TaggedStruct('ready', { host: HostHello }),
])
export type AgentToMain = typeof AgentToMain.Type
