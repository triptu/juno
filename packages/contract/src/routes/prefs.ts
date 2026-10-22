import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotSignedIn } from '../errors'
import { RecentEmoji } from '@juno/domain'
import { liveValueRoute } from '../live'

/** One workspace preference. Missing keys are null; values must be JSON. */
export const prefsGet = liveValueRoute('prefs.get', { payload: { key: Schema.String }, value: Schema.Json })
export const prefsSet = Rpc.make('prefs.set', {
  payload: { key: Schema.String, value: Schema.Json }, success: Schema.Void, error: NotSignedIn,
})
/** Whether the engine has a decision provider. No key material crosses the port. */
export const aiAvailable = liveValueRoute('ai.available', { payload: {}, value: Schema.Boolean })
/** Records a use locally. The engine owns the bounded recency list. */
export const emojiUse = Rpc.make('emoji.use', {
  payload: { name: Schema.String.check(Schema.isMinLength(1)) }, success: Schema.Void, error: NotSignedIn,
})
export const emojiRecent = liveValueRoute('emoji.recent', {
  payload: {}, value: Schema.Struct({ recent: RecentEmoji, frequent: RecentEmoji }),
})
export const PrefsRoutes = RpcGroup.make(prefsGet, prefsSet, aiAvailable, emojiUse, emojiRecent)

export const sendCheckPrefKeys = ['wrongPlace', 'typos', 'capitalI', 'questionMarks', 'longSentences', 'grammar'] as const
export type SendCheckPref = typeof sendCheckPrefKeys[number]
/** A check with no saved choice. Capital i is off so lowercase style is never flagged unless asked for. */
export const sendCheckDefaults: Readonly<Record<SendCheckPref, boolean>> = {
  wrongPlace: true, typos: true, capitalI: false, questionMarks: true, longSentences: true, grammar: true,
}
