import { EMOJI_ROWS_MAX, type EmojiChoice, type EmojiPrior } from './composer-emoji'

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
const COMMON = ['👍', '✅', '👀', '🙏', '🎉', '❤', '😂', '🔥', '💯', '🙌']
const plain = (glyph: string) => glyph.replaceAll('️', '')

/** A row's place in the common prior, or -1. A standard quick reaction also ranks its aliases, which insert the same glyph. */
type EmojiMatch = Omit<EmojiChoice, 'id' | 'insert'> & { readonly insert?: string }

function commonRank(row: EmojiMatch, quick: ReadonlyArray<EmojiPrior>): number {
  if (row.url !== undefined) return quick.findIndex((reaction) => reaction.name === row.name)
  const glyph = plain(row.insert ?? '')
  const own = quick.findIndex((reaction) => reaction.name === row.name || (reaction.url === undefined && row.url === undefined && plain(reaction.unicode) === glyph))
  if (own >= 0) return own
  const common = COMMON.indexOf(glyph)
  return common < 0 ? -1 : quick.length + common
}

/** Exact names, recent use, common emoji, prefixes, then substrings; source breaks otherwise equal ties. */
export function matchEmoji<E extends EmojiMatch>(rows: ReadonlyArray<E>, query: string, recent: ReadonlyArray<string>, quick: ReadonlyArray<EmojiPrior>, limit = EMOJI_ROWS_MAX): ReadonlyArray<E> {
  const names = (row: E) => row.keys ?? [row.name, ...row.aliases ?? []]
  const prior = (row: E) => {
    const at = recent.findIndex((name) => names(row).includes(name))
    if (at >= 0) return at
    const common = commonRank(row, quick)
    return common < 0 ? Infinity : recent.length + common
  }
  return rows.flatMap((row) => {
    const matching = names(row).filter((name) => name.includes(query))
    if (matching.length === 0) return []
    const prefixes = matching.filter((name) => name.startsWith(query))
    const order = (prefixes.length > 0 ? prefixes : matching).reduce((a, b) => a < b ? a : b)
    return [{ row, exact: matching.includes(query) ? 0 : 1, prior: prior(row), prefix: prefixes.length > 0 ? 0 : 1, order }]
  }).toSorted((a, b) => a.exact - b.exact || a.prior - b.prior || a.prefix - b.prefix
    || Number(a.row.url !== undefined) - Number(b.row.url !== undefined) || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .slice(0, limit).map(({ row }) => row)
}
