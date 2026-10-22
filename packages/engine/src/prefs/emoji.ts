import { MAX_RECENT_EMOJI, RECENT_EMOJI_PREF, recentEmojiFrom, QUICK_REACTIONS_PREF, quickReactionsFrom } from '@juno/contract'
import { prefs, StoreReader, StoreWriter, transaction } from '@juno/store'
import { Effect, Schema } from 'effect'
import type { CustomEmojiRow } from '@juno/richtext'
import { frequentEmojiNames, slackEmojiUseFrom } from './emojiRules'

export const queryRecentEmoji = Effect.map(prefs.get(RECENT_EMOJI_PREF), recentEmojiFrom)

export const queryFrequentEmoji = Effect.gen(function* () {
  const sql = yield* StoreReader
  const teams = yield* sql<{ prefs_json: string | null }>`SELECT prefs_json FROM team LIMIT 1`
  const json = teams[0]?.prefs_json
  const slackPrefs = json == null ? {} : Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(JSON.parse(json))
  const custom = yield* sql<CustomEmojiRow>`SELECT name, url, alias_for FROM emoji ORDER BY name`
  return frequentEmojiNames({
    recent: yield* queryRecentEmoji,
    slackUse: slackEmojiUseFrom(slackPrefs['emoji_use']),
    quickReactions: quickReactionsFrom(yield* prefs.get(QUICK_REACTIONS_PREF)),
    custom,
  })
})

/** Moves the name to the front. Reads through the writer so concurrent picks cannot overwrite each other's use. */
export const useEmoji = Effect.fn('Emoji.use')(function* (name: string) {
  yield* transaction(Effect.gen(function* () {
    const writer = yield* StoreWriter
    const saved = recentEmojiFrom(yield* prefs.get(RECENT_EMOJI_PREF).pipe(Effect.provideService(StoreReader, writer)))
    yield* prefs.set(RECENT_EMOJI_PREF, [name, ...saved.filter((other) => other !== name)].slice(0, MAX_RECENT_EMOJI))
  }))
})
