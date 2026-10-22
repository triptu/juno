import { MAX_RECENT_EMOJI, type QuickReaction } from '@juno/contract'
import { emojiCatalog, workspaceEmoji, type CustomEmojiRow } from '@juno/richtext'
import { Schema } from 'effect'

const standardNames = new Map(emojiCatalog.flatMap((category) => category.emoji.flatMap((emoji) =>
  [emoji.name, ...emoji.aliases ?? []].map((name) => [name, emoji.name] as const),
)))
const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Unknown))

/** Slack sends emoji_use as a JSON string of name-to-count entries. */
export function slackEmojiUseFrom(value: unknown): ReadonlyMap<string, number> {
  if (typeof value !== 'string') return new Map()
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return new Map() }
  if (!isRecord(parsed)) return new Map()
  return new Map(Object.entries(parsed).filter((entry): entry is [string, number] =>
    typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
  ))
}

/** Local picks first, Slack counts next, quick reactions last; aliases share one cell. */
export function frequentEmojiNames({ recent, slackUse, quickReactions, custom }: {
  readonly recent: ReadonlyArray<string>
  readonly slackUse: ReadonlyMap<string, number>
  readonly quickReactions: ReadonlyArray<QuickReaction>
  readonly custom: ReadonlyArray<CustomEmojiRow>
}): ReadonlyArray<string> {
  const workspaceNames = new Map<string, string>()
  for (const emoji of workspaceEmoji(custom, emojiCatalog)) {
    for (const name of [emoji.name, ...emoji.aliases]) workspaceNames.set(name, emoji.name)
  }
  const canonical = (name: string) => workspaceNames.get(name) ?? standardNames.get(name)
  const counts = new Map<string, number>()
  for (const [name, count] of slackUse) {
    const resolved = canonical(name.split('::')[0]!)
    if (resolved !== undefined) counts.set(resolved, (counts.get(resolved) ?? 0) + count)
  }
  const ranked = [...counts].sort(([a, ac], [b, bc]) => bc - ac || (a < b ? -1 : a > b ? 1 : 0))
  const seen = new Set<string>()
  const names: string[] = []
  for (const name of [...recent, ...ranked.map(([name]) => name), ...quickReactions.map((reaction) => reaction.name)]) {
    const resolved = canonical(name)
    if (resolved === undefined || seen.has(resolved)) continue
    seen.add(resolved)
    names.push(name)
    if (names.length === MAX_RECENT_EMOJI) break
  }
  return names
}
