/**
 * Emoji shortcodes: Slack names to unicode.
 *
 * The standard set comes from `emoji-catalog.ts`, generated from
 * emoji-datasource, the data Slack's own names come from. Anything missing
 * stays as `:name:` in text and as its name on a reaction chip, so an
 * unknown shortcode never breaks rendering. Custom workspace emoji come
 * from the `emoji` lookup, not from here.
 */

import { catalogData } from './emoji-catalog'

/** One category of the standard emoji, in Slack's picker order. */
export interface EmojiCategory {
  /** The heading, in sentence case: "Smileys & emotion". */
  readonly name: string
  readonly emoji: ReadonlyArray<{
    /** Slack's primary short name, for example `+1`. */
    readonly name: string
    readonly unicode: string
    /** Other names Slack accepts, for example `thumbsup`. */
    readonly aliases?: ReadonlyArray<string>
  }>
}

/** Every standard emoji the picker offers, by category. */
export const emojiCatalog: ReadonlyArray<EmojiCategory> = catalogData.map(([name = '', ...entries]) => ({
  name,
  emoji: entries.map((entry) => {
    const [unicode = '', primary = '', ...aliases] = entry.split(' ')
    return aliases.length > 0 ? { name: primary, unicode, aliases } : { name: primary, unicode }
  }),
}))

/** Every name and alias to its unicode. Built on the first lookup. */
let table: ReadonlyMap<string, string> | undefined

function lookup(name: string): string | undefined {
  if (table === undefined) {
    const byName = new Map<string, string>()
    for (const category of emojiCatalog) {
      for (const emoji of category.emoji) {
        byName.set(emoji.name, emoji.unicode)
        for (const alias of emoji.aliases ?? []) byName.set(alias, emoji.unicode)
      }
    }
    table = byName
  }
  return table.get(name)
}

/** The three one-click reactions on the hover toolbar, as Slack names. */
export const QUICK_REACTIONS: ReadonlyArray<string> = ['+1', 'white_check_mark', 'eyes']

/** The fixed 12-emoji picker, as Slack names. */
export const PICKER_EMOJI: ReadonlyArray<string> = [
  '+1',
  'heart',
  'joy',
  'tada',
  'eyes',
  'white_check_mark',
  'pray',
  'fire',
  '100',
  'open_mouth',
  'cry',
  'rocket',
]

const skinTones: ReadonlyArray<string> = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']

/**
 * Splits a Slack emoji name into its base name and skin tone, so
 * `+1::skin-tone-3` becomes `{ name: '+1', skinTone: 3 }`.
 */
export function splitEmojiName(raw: string): { readonly name: string; readonly skinTone?: number } {
  const match = /^(.*?)::skin-tone-([2-6])$/.exec(raw)
  if (match && match[1] !== undefined && match[2] !== undefined) {
    return { name: match[1], skinTone: Number(match[2]) }
  }
  return { name: raw }
}

/** Unicode for a Slack emoji name, or `undefined` when it is not a standard emoji. */
export function emojiUnicode(rawName: string): string | undefined {
  const { name, skinTone } = splitEmojiName(rawName)
  const base = lookup(name)
  if (base === undefined) return undefined
  if (skinTone === undefined) return base
  // The tone follows the first code point (the person in a ZWJ sequence such
  // as a woman raising a hand) and replaces its presentation selector.
  const [first = '', ...rest] = Array.from(base)
  if (rest[0] === '\uFE0F') rest.shift()
  return first + (skinTones[skinTone - 1] ?? '') + rest.join('')
}

/** Converts Slack's hex form ("1f44d-1f3fd") into the unicode string. */
export function unicodeFromHex(hex: string): string | undefined {
  const points = hex.split('-').map((h) => Number.parseInt(h, 16))
  if (points.length === 0 || points.some((p) => Number.isNaN(p) || p < 0 || p > 0x10ffff)) return undefined
  return String.fromCodePoint(...points)
}

/** Whether `name` is a standard emoji shortcode. */
export function isKnownEmoji(rawName: string): boolean {
  return emojiUnicode(rawName) !== undefined
}

/**
 * What to show for a reaction name: the unicode, a custom image url, or
 * the name itself when neither is known.
 */
export function reactionDisplay(
  name: string,
  customUrl?: (name: string) => string | undefined,
): { readonly kind: 'unicode'; readonly value: string } | { readonly kind: 'image'; readonly url: string } | { readonly kind: 'name'; readonly value: string } {
  const unicode = emojiUnicode(name)
  if (unicode !== undefined) return { kind: 'unicode', value: unicode }
  const url = customUrl?.(splitEmojiName(name).name)
  if (url !== undefined) return { kind: 'image', url }
  return { kind: 'name', value: name }
}

/** One row of the `emoji` table: an image url, or the name it is an alias for. */
export interface CustomEmojiRow {
  readonly name: string
  readonly url?: string | null
  readonly alias_for?: string | null
}

/** A workspace lookup, including aliases. Missing targets and cycles keep their shortcode. */
export function customEmojiLookup(emojis: ReadonlyArray<CustomEmojiRow>): (name: string) => string | undefined {
  const byName = new Map(emojis.map((emoji) => [emoji.name, emoji]))
  return (name) => {
    const seen = new Set<string>()
    let current: string | null | undefined = name
    while (current && !seen.has(current)) {
      seen.add(current)
      const emoji = byName.get(current)
      if (emoji?.url) return emoji.url
      current = emoji?.alias_for
    }
    return undefined
  }
}
