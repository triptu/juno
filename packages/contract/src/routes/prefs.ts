import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotSignedIn } from '../errors'
import { liveValueRoute } from '../live'

/** One workspace preference. Missing keys are null; values must be JSON. */
export const prefsGet = liveValueRoute('prefs.get', { payload: { key: Schema.String }, value: Schema.Json })
export const prefsSet = Rpc.make('prefs.set', {
  payload: { key: Schema.String, value: Schema.Json }, success: Schema.Void, error: NotSignedIn,
})
export const PrefsRoutes = RpcGroup.make(prefsGet, prefsSet)
