import { QUICK_REACTIONS_PREF, quickReactionsFrom, RECENT_EMOJI_PREF } from '@juno/contract'
import { frequentEmoji, recentEmojiFrom, recordEmojiUse } from '@juno/domain'
import { prefs, StoreReader, StoreWriter, transaction } from '@juno/store'
import { Effect } from 'effect'

export const queryRecentEmoji = Effect.gen(function* () {
  const recent = recentEmojiFrom(yield* prefs.get(RECENT_EMOJI_PREF))
  const quick = quickReactionsFrom(yield* prefs.get(QUICK_REACTIONS_PREF))
  return { recent, frequent: frequentEmoji(recent, quick) }
})

/** Read through the writer so concurrent picks cannot overwrite each other's use. */
export const useEmoji = Effect.fn('Emoji.use')(function* (name: string) {
  yield* transaction(Effect.gen(function* () {
    const writer = yield* StoreWriter
    const saved = yield* prefs.get(RECENT_EMOJI_PREF).pipe(Effect.provideService(StoreReader, writer))
    yield* prefs.set(RECENT_EMOJI_PREF, recordEmojiUse(recentEmojiFrom(saved), name))
  }))
})
