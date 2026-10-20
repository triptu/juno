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
  readonly aliases?: ReadonlyArray<string>
  readonly keys?: ReadonlyArray<string>
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
  const match = /(?:^|[^\p{L}\p{N}_:])(:([\p{L}\p{M}\p{N}_+-]{1,}))$/u.exec(text.slice(0, caret))
  return match?.[1] === undefined ? undefined : { start: caret - match[1].length, end: caret, text: match[2]!.toLowerCase() }
}

/** The list opens from two characters; one is too few to narrow the catalog. */
export const EMOJI_QUERY_MIN = 2

/** The most rows the list shows. */
export const EMOJI_ROWS_MAX = 8
