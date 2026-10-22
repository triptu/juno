import { customEmoji, emojiCatalog } from '@juno/contract'
import type { EmojiSuggestion } from '@juno/views'

/** Loaded on the first colon query. Aliases remain searchable shortcodes. */
export const standardEmoji: ReadonlyArray<EmojiSuggestion> = emojiCatalog.flatMap((category) => category.emoji.flatMap((emoji) =>
  [emoji.name, ...emoji.aliases ?? []].map((name) => ({ id: name, name, insert: emoji.unicode })))).toSorted((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/** Built by the shared resolver only when the workspace answer changes. */
export const workspaceChoices = (rows: Parameters<typeof customEmoji>[0]): ReadonlyArray<EmojiSuggestion> => customEmoji(rows, emojiCatalog).map((emoji) => ({ id: emoji.name, name: emoji.name, insert: emoji.unicode ?? `:${emoji.canonical}:`, ...(emoji.url === undefined ? {} : { url: emoji.url }) }))

export { matchEmoji, mergeEmoji, warmEmojiSearch, isEmojiSearchWarm } from '@juno/contract'
