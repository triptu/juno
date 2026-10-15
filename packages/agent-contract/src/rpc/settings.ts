import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { JunoSettingsPage } from '../chat'
import { Accepted, AgentCommandError, operation } from './common'

export const SettingsChange = Schema.Union([
  /** On a custom endpoint `family` is the model id, listed or typed; only `chat` applies there. */
  Schema.TaggedStruct('model', {
    purpose: Schema.Literals(['chat', 'compaction']),
    provider: Schema.Literals(['openrouter', 'codex', 'custom']),
    family: Schema.String.check(Schema.isMaxLength(256)),
  }),
  Schema.TaggedStruct('cap', { usd: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)) }),
  Schema.TaggedStruct('paused', { value: Schema.Boolean }),
  Schema.TaggedStruct('rules', { rules: Schema.Array(Schema.Struct({ id: Schema.String.pipe(Schema.brand('AgentRuleId')), text: Schema.String })) }),
  Schema.TaggedStruct('backupFolder', { path: Schema.String }),
])
export type SettingsChange = typeof SettingsChange.Type
export const settingsPage = Rpc.make('agent.settings.page', { success: JunoSettingsPage, stream: true })
export const settingsChange = Rpc.make('agent.settings.change', { payload: { ...operation, change: SettingsChange }, success: Accepted, error: AgentCommandError })
/**
 * Secret values stay in main's keychain flow. They never enter the durable
 * inbox and never cross this port. The OpenRouter key is set and removed
 * through main (`window.juno.agent.setOpenRouterKey`); this RPC is for the
 * Codex sign-in (WP20) and answers `unavailable` until then.
 */
export const settingsCredentials = Rpc.make('agent.settings.credentials', { payload: { provider: Schema.Literals(['openrouter', 'codex']),
  action: Schema.Literals(['setUp', 'remove']) }, success: Schema.Void, error: AgentCommandError })
export const settingsOwnership = Rpc.make('agent.settings.ownership', { payload: { ...operation, action: Schema.Union([
  Schema.TaggedStruct('exportPhrase', {}), Schema.TaggedStruct('move', {}),
  Schema.TaggedStruct('restore', { backupPath: Schema.String, oldDeviceOffOrErased: Schema.Literal(true) }),
]) }, success: Accepted, error: AgentCommandError })
export const SettingsRpcs = RpcGroup.make(settingsPage, settingsChange, settingsCredentials, settingsOwnership)
