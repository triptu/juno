import { workspaceEmoji, type EmojiCategory, type CustomEmojiRow } from '@juno/richtext'

/** Composer names and aliases use the picker's cached resolved entries. */
const EMPTY_CATALOG: ReadonlyArray<EmojiCategory> = []
const choices = new WeakMap<ReturnType<typeof workspaceEmoji>, ReturnType<typeof composerChoices>>()
export function customEmoji(rows: ReadonlyArray<CustomEmojiRow>, catalog: ReadonlyArray<EmojiCategory> = EMPTY_CATALOG) {
  const entries = workspaceEmoji(rows, catalog)
  let value = choices.get(entries)
  if (value === undefined) { value = composerChoices(entries); choices.set(entries, value) }
  return value
}
function composerChoices(entries: ReturnType<typeof workspaceEmoji>) {
  return entries.flatMap((emoji) => [emoji.name, ...emoji.aliases].map((name) => ({ name, canonical: emoji.name, url: emoji.url, unicode: emoji.unicode })))
    .toSorted((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}
