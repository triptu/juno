import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotSignedIn } from '../errors'
import { liveValueRoute } from '../live'

/** One workspace preference. Missing keys are null; values must be JSON. */
export const prefsGet = liveValueRoute('prefs.get', { payload: { key: Schema.String }, value: Schema.Json })
export const prefsSet = Rpc.make('prefs.set', {
  payload: { key: Schema.String, value: Schema.Json }, success: Schema.Void, error: NotSignedIn,
})
/** Whether the engine has a decision provider. No key material crosses the port. */
export const aiAvailable = liveValueRoute('ai.available', { payload: {}, value: Schema.Boolean })
export const PrefsRoutes = RpcGroup.make(prefsGet, prefsSet, aiAvailable)

export const sendCheckPrefKeys = ['wrongPlace', 'typos', 'capitalI', 'questionMarks', 'longSentences', 'grammar'] as const
export type SendCheckPref = typeof sendCheckPrefKeys[number]
