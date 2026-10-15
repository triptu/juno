import { emojiCatalog } from '@juno/contract'
import type { EmojiSuggestion } from '@juno/views'

/** Loaded on the first colon query. Aliases remain searchable shortcodes. */
export const standardEmoji: ReadonlyArray<EmojiSuggestion> = emojiCatalog.flatMap((category) => category.emoji.flatMap((emoji) =>
  [emoji.name, ...emoji.aliases ?? []].map((name) => ({ id: name, name, insert: emoji.unicode })))).toSorted((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
