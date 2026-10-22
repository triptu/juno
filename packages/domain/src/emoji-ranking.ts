import { emojiCatalog, emojiKeywordData, splitEmojiName } from '@juno/richtext'
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
 * Popular emoji, ranked after the user's frequent emoji and quick reactions within a match tier (SPEC 8),
 * so `sad` offers 😢 and 😭 before rarer sad faces.
 */
const POPULAR = [
  '👍', '✅', '👀', '🙏', '🎉', '❤', '😂', '🔥', '💯', '🙌',
  '😭', '😍', '🤣', '😊', '👏', '😅', '🤔', '😢', '💪', '😎', '🥳', '😁', '😆', '😄', '😀', '😃', '🙂', '😉',
  '👌', '🚀', '✨', '👎', '🙅‍♀️', '🚫', '⛔', '😮', '🤦', '🤷', '😬', '🙈', '💔', '😞', '😔', '🥲', '😡', '👋',
  '☕', '🤩', '🥰', '😘',
  '😴', '😱', '🤯', '💀', '☠', '😵', '😳', '🙃', '😐', '🙄', '😤', '😩', '😕', '☹', '🙁', '😿', '👻', '💩', '🤖', '❌',
  '✔', '☑', '💰', '💸', '🤑', '🍕', '🍺', '🍻', '🐶', '🐱', '⭐', '🌟', '☀', '🌧', '🐛', '🚢', '🎊', '🤝', '🆘', '🛟',
]

/** What the search knows about a row: its names, its words and where it ranks among equals. */
interface Entry<E> {
  readonly row: E
  /** One per emoji: a standard glyph, or a workspace emoji's insert or image. */
  readonly key: string
  readonly custom: boolean
  /** Catalog position for a standard emoji, for ties. */
  readonly order: number
  readonly names: ReadonlyArray<string>
  /** Each name in words: `no_entry` is `no`, `entry`. */
  readonly nameWords: ReadonlyArray<ReadonlyArray<string>>
  /** Each name without separators, so `thumbs up` and `thumbsup` are the same. */
  readonly compact: ReadonlyArray<string>
  /** The two-letter country code from a `flag-xx` name. */
  readonly countryCode?: string
  readonly related: ReadonlyArray<string>
  readonly keywords: ReadonlyArray<string>
  /** Words of the model-written everyday phrases: `ugh`, `so`, `done` for 😩. */
  readonly intent: ReadonlyArray<string>
  /** Every name word and keyword after a space, to reject a row with one `includes`. */
  readonly words: string
}

interface Query {
  readonly words: ReadonlyArray<string>
  readonly compact: string
}

const plain = (glyph: string) => glyph.replaceAll('️', '')
/** A hyphen inside a name separates words; a leading one is part of the name, as in `-1`. */
const wordsOf = (text: string): ReadonlyArray<string> => text.toLowerCase().replace(/(?!^)-/g, ' ').split(/[\s_:]+/).filter((word) => word !== '')

/** Each standard glyph's search words and catalog position. Built on the first search. */
let standard: ReadonlyMap<string, { readonly keywords: ReadonlyArray<string>; readonly related: ReadonlyArray<string>; readonly intent: ReadonlyArray<string>; readonly order: number }> | undefined
function standardInfo() {
  if (standard !== undefined) return standard
  const lines = emojiKeywordData.split('\n')
  const info = new Map<string, { keywords: ReadonlyArray<string>; related: ReadonlyArray<string>; intent: ReadonlyArray<string>; order: number }>()
  const split = (words: string) => (words === '' ? [] : words.split(' '))
  let order = 0
  for (const category of emojiCatalog) {
    for (const emoji of category.emoji) {
      const [chat = '', related = '', intent = ''] = (lines[order] ?? '').split('|')
      info.set(plain(emoji.unicode), { keywords: split(chat), related: split(related), intent: split(intent), order })
      order += 1
    }
  }
  standard = info
  return info
}

type Row = Omit<EmojiChoice, 'id' | 'insert'> & { readonly insert?: string; readonly unicode?: string }

function entryOf<E extends Row>(row: E, withKeywords = true, order = Infinity): Entry<E> {
  const glyph = row.url === undefined ? row.unicode ?? row.insert : undefined
  const info = !withKeywords || glyph === undefined ? undefined : standardInfo().get(plain(glyph).replace(/[\u{1F3FB}-\u{1F3FF}]/gu, ''))
  const names = row.keys ?? [row.name, ...row.aliases ?? []].map((name) => name.toLowerCase())
  const nameWords = names.map(wordsOf)
  const countryCode = info === undefined ? undefined : nameWords.find((words) => words.length === 2 && words[0] === 'flag' && words[1]?.length === 2)?.[1]
  const keywords = info?.keywords ?? []
  return {
    row,
    key: glyph === undefined ? `w:${row.insert ?? row.name}` : `g:${plain(glyph)}`,
    custom: glyph === undefined,
    order: info?.order ?? order,
    names,
    nameWords,
    compact: nameWords.map((words) => words.join('')),
    ...(countryCode === undefined ? {} : { countryCode }),
    keywords,
    related: info?.related ?? [],
    intent: info?.intent ?? [],
    words: ` ${[...nameWords.flat(), ...keywords, ...info?.related ?? [], ...info?.intent ?? []].join(' ')}`,
  }
}

/**
 * Built once per row list, so each keystroke only compares. Entries are kept per row too, so a list that adds
 * workspace emoji to the same standard rows does not split their words again.
 */
const indexes = new WeakMap<ReadonlyArray<Row>, ReadonlyArray<Entry<Row>>>()
const entries = new WeakMap<Row, Entry<Row>>()
function indexOf<E extends Row>(rows: ReadonlyArray<E>): ReadonlyArray<Entry<E>> {
  let index = indexes.get(rows) as ReadonlyArray<Entry<E>> | undefined
  if (index === undefined) {
    index = rows.map((row) => {
      let entry = entries.get(row) as Entry<E> | undefined
      if (entry === undefined) entries.set(row, entry = entryOf(row))
      return entry
    })
    indexes.set(rows, index)
  }
  return index
}

export const isEmojiSearchWarm = (rows: ReadonlyArray<Row>): boolean => indexes.has(rows)

/** Builds the search index for `rows` ahead of the first keystroke: about 10 ms for the standard emoji. */
export function warmEmojiSearch(rows: ReadonlyArray<Row>): void {
  indexOf(rows)
}

const NONE = 99
/**
 * Match tiers, best first:
 * 0 a name or alias is the query; 1 every query word is a name word or keyword;
 * for queries of three or more characters, 2 a whole CLDR word and 3 a whole phrase word;
 * 4 a name starts with the query; 5 every query word starts a name word;
 * 6 every query word starts a name word or curated keyword; 7 a CLDR word; 8 a word of an everyday phrase;
 * 9 a two-letter flag code without `flag`; 10 a CLDR word prefix; 11 a phrase word prefix;
 * 12, only when nothing else matched, a typo away.
 */
function tierOf(entry: Entry<Row>, query: Query): { readonly tier: number; readonly byName: boolean } {
  let tier = NONE
  for (const compact of entry.compact) {
    if (compact === query.compact) return { tier: 0, byName: true }
    if (compact.startsWith(query.compact)) tier = 4
  }
  let worst = 0
  let byName = tier !== NONE
  let named = true
  const wholeRelatedTier = query.compact.length >= 3 ? 2 : 7
  const wholeIntentTier = query.compact.length >= 3 ? 3 : 8
  for (const word of query.words) {
    let best = NONE
    let found = false
    for (const words of entry.nameWords) {
      for (const own of words) {
        if (own === word) { best = 1; found = true } else if (own.startsWith(word)) { best = Math.min(best, 5); found = true }
      }
    }
    if (best > 1) {
      for (const own of entry.keywords) {
        if (own === word) { best = 1; break }
        if (best > 6 && own.startsWith(word)) best = 6
      }
    }
    if (best > wholeRelatedTier) for (const own of entry.related) {
      if (own === word) { best = wholeRelatedTier; break }
      if (best > 10 && own.startsWith(word)) best = 10
    }
    if (best > wholeIntentTier) for (const own of entry.intent) {
      if (own === word) { best = wholeIntentTier; break }
      if (best > 11 && own.startsWith(word)) best = 11
    }
    worst = Math.max(worst, best)
    named &&= found
    if (worst === NONE) break
  }
  const best = Math.min(tier, worst)
  const codeOnly = query.words.length === 1 && query.words[0] === entry.countryCode && best === 1
  return { tier: codeOnly ? 9 : best, byName: byName || named }
}

/**
 * Whether `word` becomes `own`'s first `length` characters with at most one insertion, deletion, substitution or
 * swap of neighbours. Compares in place: this runs over every word when nothing else matched.
 */
function oneEdit(word: string, own: string, length: number): boolean {
  if (length > own.length || Math.abs(word.length - length) > 1) return false
  let i = 0
  while (i < word.length && i < length && word.charCodeAt(i) === own.charCodeAt(i)) i++
  const same = (from: number, to: number, end: number) => {
    for (let k = 0; from + k < end; k++) if (word.charCodeAt(from + k) !== own.charCodeAt(to + k)) return false
    return true
  }
  if (word.length === length) {
    return same(i + 1, i + 1, word.length) || (word[i] === own[i + 1] && word[i + 1] === own[i] && same(i + 2, i + 2, word.length))
  }
  return word.length < length ? same(i, i + 1, word.length) : same(i + 1, i, word.length)
}

/** A word of three or more letters one typo away from a word or its start. */
function nearly(word: string, own: string): boolean {
  if (word.length < 3) return own.startsWith(word)
  return oneEdit(word, own, word.length) || oneEdit(word, own, word.length - 1) || oneEdit(word, own, word.length + 1)
}

/**
 * Emoji for a search, best first: the match tier, then the user's frequent emoji, their quick reactions and
 * popular emoji, then name matches before keyword matches, standard before workspace, and catalog or name order.
 * A typo is forgiven only when nothing matches as typed. Each emoji appears once, under its best-matching name.
 */
export function matchEmoji<E extends Row>(rows: ReadonlyArray<E>, search: string, frequent: ReadonlyArray<string>, quick: ReadonlyArray<EmojiPrior>, limit = EMOJI_ROWS_MAX, ready = true): ReadonlyArray<E> {
  const words = wordsOf(search)
  if (words.length === 0) return []
  const query = { words, compact: words.join('') }
  const index = ready ? indexOf(rows) : rows.map((row, order) => entryOf(row, false, order))
  const found: Array<{ readonly entry: Entry<E>; readonly tier: number; readonly byName: boolean }> = []
  for (const entry of index) {
    if (!entry.compact.some((compact) => compact.startsWith(query.compact)) && !words.every((word) => entry.words.includes(` ${word}`))) continue
    const { tier, byName } = tierOf(entry, query)
    if (tier !== NONE) found.push({ entry, tier, byName })
  }
  if (ready && found.length === 0) {
    for (const entry of index) {
      if (words.every((word) => entry.nameWords.some((own) => own.some((name) => nearly(word, name))) || [...entry.keywords, ...entry.related, ...entry.intent].some((own) => nearly(word, own)))) found.push({ entry, tier: 12, byName: false })
    }
  }
  const rank = priors(index, frequent, quick)
  const seen = new Set<string>()
  return found.map((match) => ({ ...match, prior: rank.get(match.entry.key) ?? Infinity }))
    .sort((a, b) => a.tier - b.tier || a.prior - b.prior || Number(b.byName) - Number(a.byName)
    || Number(a.entry.custom) - Number(b.entry.custom) || a.entry.order - b.entry.order || (a.entry.row.name < b.entry.row.name ? -1 : a.entry.row.name > b.entry.row.name ? 1 : 0))
    .flatMap(({ entry }) => {
      if (seen.has(entry.key)) return []
      seen.add(entry.key)
      return [entry.row]
    })
    .slice(0, limit)
}

/** Each emoji's place among the frequent emoji, then the quick reactions, then the popular list. */
function priors(index: ReadonlyArray<Entry<Row>>, frequent: ReadonlyArray<string>, quick: ReadonlyArray<EmojiPrior>): ReadonlyMap<string, number> {
  const keys = keysByName(index)
  const rank = new Map<string, number>()
  const add = (key: string | undefined) => { if (key !== undefined && !rank.has(key)) rank.set(key, rank.size) }
  for (const name of frequent) add(keys.get(splitEmojiName(name.toLowerCase()).name))
  for (const reaction of quick) add(reaction.url === undefined ? `g:${plain(reaction.unicode).replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')}` : keys.get(reaction.name.toLowerCase()))
  for (const glyph of POPULAR) add(`g:${plain(glyph)}`)
  return rank
}

/** Workspace names override standard names, as Slack resolves a saved shortcode. */
const names = new WeakMap<ReadonlyArray<Entry<Row>>, ReadonlyMap<string, string>>()
function keysByName(index: ReadonlyArray<Entry<Row>>): ReadonlyMap<string, string> {
  let keys = names.get(index)
  if (keys === undefined) {
    const map = new Map<string, string>()
    for (const entry of index) for (const name of entry.names) if (!map.has(name) || entry.custom) map.set(name, entry.key)
    names.set(index, keys = map)
  }
  return keys
}
