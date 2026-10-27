/**
 * Channel names as Slack takes them (research `slack-channels.md`), for the
 * channel sheet (SPEC 5, "Channel sheet"): what the user typed, made into a
 * name Slack accepts, and whether that changed it.
 */

/** Slack's longest channel name, in graphemes. */
export const CHANNEL_NAME_MAX = 80

let segmenter: Intl.Segmenter | undefined

/**
 * Lowercase, spaces to hyphens, and only letters, digits, hyphens and
 * underscores kept, at most 80 graphemes. Letters include other scripts and
 * accents, which Slack takes; punctuation, symbols and emoji, which it
 * refuses, are dropped. A leading "#" is dropped, since the field shows
 * one. `changed` is true when the result is not what was typed, so the
 * sheet can say Slack's rules changed it. A name of hyphens and
 * underscores alone is left for Slack to refuse.
 */
export function normalizeChannelName(typed: string): { readonly name: string; readonly changed: boolean } {
  const withoutHash = typed.replace(/^#+/, '')
  const kept = withoutHash
    .toLowerCase()
    .replace(/\s/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}_-]/gu, '')
  // A grapheme is at least one code unit, so a short name needs no counting.
  const name = kept.length <= CHANNEL_NAME_MAX ? kept : graphemesUpTo(kept, CHANNEL_NAME_MAX)
  return { name, changed: name !== withoutHash }
}

/** The first `max` graphemes, as Slack counts a name. The segmenter is made on first use, not at startup. */
function graphemesUpTo(text: string, max: number): string {
  segmenter ??= new Intl.Segmenter()
  const graphemes = [...segmenter.segment(text)]
  return graphemes.length <= max ? text : graphemes.slice(0, max).map((part) => part.segment).join('')
}
