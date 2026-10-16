/**
 * Colon emoji in the composer (spec section 8): the ":smi" being typed, the
 * workspace's custom emoji with aliases resolved, and which emoji match, in
 * order. Pure rules the renderer runs on each keystroke, reached through
 * `@juno/contract`.
 */

/** One emoji the list can offer: `insert` is the glyph, or `:name:` for a custom emoji with its image at `url`. */
export interface EmojiChoice {
  readonly id: string
  readonly name: string
  readonly insert: string
  readonly url?: string
}

/** A quick reaction, as far as ranking needs it: a standard one has no `url`. */
export interface EmojiPrior {
  readonly name: string
  readonly unicode: string
  readonly url?: string
}

/** The ":smi" before the caret: the colon at `start`, the lowercased name typed after it in `text`. */
export interface EmojiQuery {
  readonly start: number
  readonly end: number
  readonly text: string
}

/** The colon query ending at the caret. A colon inside a word, or after another colon, starts none. */
export function emojiQueryAt(text: string, caret: number): EmojiQuery | undefined {
  if (!text.includes(':')) return undefined
  const match = /(?:^|[^\p{L}\p{N}_:])(:([a-zA-Z0-9_+-]{1,}))$/u.exec(text.slice(0, caret))
  return match?.[1] === undefined ? undefined : { start: caret - match[1].length, end: caret, text: match[2]!.toLowerCase() }
}

/** The list opens from two characters; one is too few to narrow the catalog. */
export const EMOJI_QUERY_MIN = 2

/** The most rows the list shows. */
export const EMOJI_ROWS_MAX = 8

interface WorkspaceEmoji {
  readonly name: string
  readonly url: string | null
  readonly alias_for: string | null
}

/** The workspace's custom emoji with images, aliases resolved to their target's image, in name order. */
export function customEmoji(rows: ReadonlyArray<WorkspaceEmoji>): ReadonlyArray<{ readonly name: string; readonly url: string }> {
  if (rows.length === 0) return []
  const byName = new Map(rows.map((emoji) => [emoji.name, emoji]))
  return rows.flatMap((emoji) => {
    let target: WorkspaceEmoji | undefined = emoji
    const seen = new Set<string>()
    while (target?.url == null && target?.alias_for != null && !seen.has(target.name)) {
      seen.add(target.name)
      target = byName.get(target.alias_for)
    }
    return target?.url == null ? [] : [{ name: emoji.name, url: target.url }]
  }).toSorted((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

/** Both inputs are sorted; custom names replace standard names without sorting the catalog again. */
export function mergeEmoji<E extends EmojiChoice>(standard: ReadonlyArray<E>, custom: ReadonlyArray<E>): ReadonlyArray<E> {
  if (custom.length === 0) return standard
  const rows: E[] = []
  let at = 0
  for (const emoji of standard) {
    while (at < custom.length && custom[at]!.name < emoji.name) rows.push(custom[at++]!)
    if (custom[at]?.name === emoji.name) rows.push(custom[at++]!)
    else rows.push(emoji)
  }
  return [...rows, ...custom.slice(at)]
}

/**
 * The common prior, ranked after recent use and before name order, so `:thumbs` offers 👍 before 👎 (SPEC 8):
 * the user's quick reactions in their order, then these common emoji.
 */
const COMMON = ['👍', '✅', '👀', '🙏', '🎉', '❤️', '😂', '🔥', '💯', '🙌'].map((glyph) => glyph.replaceAll('️', ''))
const plain = (glyph: string) => glyph.replaceAll('️', '')

/** A row's place in the common prior, or -1. A standard quick reaction also ranks its aliases, which insert the same glyph. */
function commonRank(row: EmojiChoice, quick: ReadonlyArray<EmojiPrior>): number {
  const glyph = plain(row.insert)
  const own = quick.findIndex((reaction) => reaction.name === row.name || (reaction.url === undefined && row.url === undefined && plain(reaction.unicode) === glyph))
  if (own >= 0) return own
  const common = COMMON.indexOf(glyph)
  return common < 0 ? -1 : quick.length + common
}

/**
 * The rows whose name contains `query`: the recently used first, in `recent`'s order, then the quick reactions and
 * the common emoji, then names that start with the query, then the rest, at most `EMOJI_ROWS_MAX`.
 */
export function matchEmoji<E extends EmojiChoice>(rows: ReadonlyArray<E>, query: string, recent: ReadonlyArray<string>, quick: ReadonlyArray<EmojiPrior>): ReadonlyArray<E> {
  const matches = rows.filter((row) => row.name.includes(query))
  const frequent = recent.flatMap((name) => matches.find((row) => row.name === name) ?? [])
  const rest = matches.filter((row) => !recent.includes(row.name))
  const rank = new Map(rest.map((row) => [row, commonRank(row, quick)]))
  const common = rest.filter((row) => rank.get(row)! >= 0).toSorted((a, b) => rank.get(a)! - rank.get(b)!)
  const others = rest.filter((row) => rank.get(row)! < 0)
  return [...frequent, ...common, ...others.filter((row) => row.name.startsWith(query)), ...others.filter((row) => !row.name.startsWith(query))].slice(0, EMOJI_ROWS_MAX)
}
