/**
 * Emoji as the views draw them: a standard emoji's text, or a workspace
 * custom emoji's image read from the store, aliases followed. Messages,
 * reactions, search cards and statuses share it.
 */
import { emojiUnicode, splitEmojiName } from '@juno/richtext'
import type { SqlClient } from '@juno/store'
import { Effect } from 'effect'

/** Custom emoji read so far: a url, or null for none; and the custom names that alias a standard emoji. */
export interface EmojiCache {
  readonly emoji: Map<string, string | null>
  readonly emojiAliases: Map<string, string>
}

/** Custom emoji by name, following an alias to another custom emoji (`alias:name`) up to three times. */
export const readEmoji = (sql: SqlClient.SqlClient, cache: EmojiCache, names: Iterable<string>) =>
  Effect.gen(function* () {
    let missing = [...names].filter((name) => !cache.emoji.has(name))
    const aliases = new Map<string, string>()
    for (let hop = 0; hop < 4 && missing.length > 0; hop++) {
      for (const name of missing) cache.emoji.set(name, null)
      const rows = yield* sql<{ name: string; url: string | null; alias_for: string | null }>`SELECT name, url, alias_for FROM emoji WHERE name IN ${sql.in(missing)}`
      const next: Array<string> = []
      for (const row of rows) {
        const target = row.alias_for ?? (row.url?.startsWith('alias:') ? row.url.slice('alias:'.length) : undefined)
        if (target !== undefined) {
          aliases.set(row.name, target)
          if (!cache.emoji.has(target)) next.push(target)
        } else if (row.url) {
          cache.emoji.set(row.name, row.url)
        }
      }
      missing = next
    }
    for (const [name, target] of aliases) {
      let url = cache.emoji.get(target) ?? null
      let hops = 0
      let current = target
      while (url === null && aliases.has(current) && hops++ < 3) {
        current = aliases.get(current)!
        url = cache.emoji.get(current) ?? null
      }
      cache.emoji.set(name, url)
      // An alias of a standard emoji (`alias:thumbsup`) shows that emoji.
      if (url === null) cache.emojiAliases.set(name, current)
    }
  })

/** A reaction's emoji as the views draw it: a standard emoji's text, or a custom emoji's image, from the emoji `readEmoji` read. */
export function reactionEmoji(name: string, cache: EmojiCache): { readonly unicode?: string; readonly url?: string } {
  const standard = emojiUnicode(name)
  if (standard !== undefined) return { unicode: standard }
  const base = splitEmojiName(name).name
  const url = cache.emoji.get(base) ?? undefined
  if (url !== undefined) return { url }
  const alias = cache.emojiAliases.get(base)
  const unicode = alias === undefined ? undefined : emojiUnicode(alias)
  return unicode === undefined ? {} : { unicode }
}
