import { emojiCatalog } from '@juno/contract'
import type { EmojiSuggestion } from '@juno/views'

/** Loaded after paint, like the reaction picker's catalog. Aliases remain searchable shortcodes. */
export const standardEmoji: ReadonlyArray<EmojiSuggestion> = emojiCatalog.flatMap((category) => category.emoji.flatMap((emoji) =>
  [emoji.name, ...emoji.aliases ?? []].map((name) => ({ id: name, name, insert: emoji.unicode })))).toSorted((a, b) => a.name.localeCompare(b.name))
