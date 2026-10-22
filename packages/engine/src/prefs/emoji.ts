import { MAX_RECENT_EMOJI, RECENT_EMOJI_PREF, recentEmojiFrom } from '@juno/contract'
import { prefs, StoreReader, StoreWriter, transaction } from '@juno/store'
import { Effect } from 'effect'

export const queryRecentEmoji = Effect.map(prefs.get(RECENT_EMOJI_PREF), recentEmojiFrom)

/** Moves the name to the front. Reads through the writer so concurrent picks cannot overwrite each other's use. */
export const useEmoji = Effect.fn('Emoji.use')(function* (name: string) {
  yield* transaction(Effect.gen(function* () {
    const writer = yield* StoreWriter
    const saved = recentEmojiFrom(yield* prefs.get(RECENT_EMOJI_PREF).pipe(Effect.provideService(StoreReader, writer)))
    yield* prefs.set(RECENT_EMOJI_PREF, [name, ...saved.filter((other) => other !== name)].slice(0, MAX_RECENT_EMOJI))
  }))
})
