const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * The first user-perceived character of a string: "🦄" from "🦄 Unicorn",
 * "é" from "é", never half of a surrogate pair. ASCII takes a fast
 * path, since a sidebar draws hundreds of initials.
 */
export function firstGrapheme(text: string): string {
  if (text.length === 0) return ''
  if (text.charCodeAt(0) < 0x80 && (text.length === 1 || text.charCodeAt(1) < 0x80)) return text.charAt(0)
  for (const { segment } of segmenter.segment(text)) return segment
  return ''
}
