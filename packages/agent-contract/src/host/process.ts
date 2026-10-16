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
  /** Under Playwright only: this Mac's name in the backup manifest. Otherwise the agent reads the computer name. */
  deviceName: Schema.optionalKey(Schema.String),
  /** Under Playwright only: how often the backup exports what changed. Otherwise once a minute. */
  backupIntervalMs: Schema.optionalKey(Schema.Number),
  /** The `agent.codemode` flag: the model may run read-only scripts (docs/research/codemode.md). Off when absent. */
  codemode: Schema.optionalKey(Schema.Boolean),
})
export type AgentConfig = typeof AgentConfig.Type

/**
 * The model provider main hands the agent (SPEC 13.10): OpenRouter with its
 * key, or one OpenAI-compatible endpoint with its base URL and maybe a key.
 * Keys come from the keychain (or `OPENROUTER_API_KEY` in development) and
 * stay in the agent's memory.
 */
export const AgentProvider = Schema.Union([
  Schema.TaggedStruct('openRouter', { key: Schema.String }),
  Schema.TaggedStruct('custom', { baseUrl: Schema.String, key: Schema.NullOr(Schema.String) }),
])
export type AgentProvider = typeof AgentProvider.Type

/**
 * main -> agent. A `hostPort` message carries a port to the host in
 * `ports[0]`; a new one follows every host restart. A `rendererPort` carries
 * a port to one renderer, for the agent's RPCs (`AgentRpcs`). `provider` is
 * the active provider, sent at spawn and again on every change from
 * Settings › Juno. Main runs the agent only while one is set up, so `null`
 * comes only just before main stops it.
 */
export const MainToAgent = Schema.Union([
  Schema.TaggedStruct('config', { config: AgentConfig }),
  Schema.TaggedStruct('hostPort', {}),
  Schema.TaggedStruct('rendererPort', {}),
  Schema.TaggedStruct('provider', { provider: Schema.NullOr(AgentProvider) }),
  /** Main's answer to a `credential` request. `value` is only set for `load`. */
  Schema.TaggedStruct('credentialReply', { requestId: Schema.Number, ok: Schema.Boolean, value: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
  /** Main's answer to a `secret` request. `value` is only set for `get`; null when there is none. */
  Schema.TaggedStruct('secretReply', { requestId: Schema.Number, ok: Schema.Boolean, value: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
])
export type MainToAgent = typeof MainToAgent.Type

/**
 * What the MCP manager asks main for (WP17). Main owns the keychain: an MCP
 * connection's OAuth state (`load`, `save`, `clear`) is kept there by
 * connection id, never in a file. `open` shows an authorization URL in the
 * system browser. Main answers each with a `credentialReply`.
 */
export const CredentialRequest = Schema.Union([
  Schema.TaggedStruct('load', { id: Schema.String }),
  Schema.TaggedStruct('save', { id: Schema.String, state: Schema.String }),
  Schema.TaggedStruct('clear', { id: Schema.String }),
  Schema.TaggedStruct('open', { url: Schema.String }),
])
export type CredentialRequest = typeof CredentialRequest.Type

/** The backup's secrets in main's keychain (WP21): the backup key, the deletion record and the recovery phrase. */
export const BackupSecretName = Schema.Literals(['backupKey', 'deletionRecord', 'recoveryPhrase'])
export type BackupSecretName = typeof BackupSecretName.Type

/**
 * What the backup asks main for (WP21). Main keeps each secret in the login
 * keychain and nowhere else. A `set` of `recoveryPhrase` is an export: main
 * shows the phrase to the owner once.
 */
export const SecretRequest = Schema.Union([
  Schema.TaggedStruct('get', { name: BackupSecretName }),
  Schema.TaggedStruct('set', { name: BackupSecretName, value: Schema.String }),
])
export type SecretRequest = typeof SecretRequest.Type

/** agent -> main. */
export const AgentToMain = Schema.Union([
  /** The agent reached its host on the current port. */
  Schema.TaggedStruct('ready', { host: HostHello }),
  Schema.TaggedStruct('credential', { requestId: Schema.Number, request: CredentialRequest }),
  Schema.TaggedStruct('secret', { requestId: Schema.Number, request: SecretRequest }),
  /** The agent is about to exit so a staged restore installs at the next open. Main starts it again at once. */
  Schema.TaggedStruct('restart', {}),
])
export type AgentToMain = typeof AgentToMain.Type
