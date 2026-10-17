/**
 * A JSON value as a person reads it on a card (SPEC 13.3): a string bare, a
 * short list of strings on one line, and anything larger as indented
 * `key: value` lines. Only for showing; the payload a click authorizes is
 * still the canonical JSON.
 */

/** A list of short values fits one line up to this many characters. */
const INLINE_LIST = 60

const isScalar = (value: unknown): value is string | number | boolean | null =>
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

const scalar = (value: string | number | boolean | null): string => (value === null ? 'none' : String(value))

function lines(value: unknown): ReadonlyArray<string> {
  if (isScalar(value)) return scalar(value).split('\n')
  if (Array.isArray(value)) {
    if (value.length === 0) return ['none']
    if (value.every(isScalar)) {
      const items = value.map(scalar)
      const inline = items.join(', ')
      if (inline.length <= INLINE_LIST && !inline.includes('\n')) return [inline]
    }
    return value.flatMap((item) => {
      const [first = '', ...rest] = lines(item)
      return [`• ${first}`, ...rest.map((line) => `  ${line}`)]
    })
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
    if (entries.length === 0) return ['none']
    return entries.flatMap(([key, item]) => {
      const inner = lines(item)
      // One short line stays beside its key; anything longer goes under it.
      return inner.length === 1 && (isScalar(item) || (Array.isArray(item) && item.every(isScalar)))
        ? [`${key}: ${inner[0]}`]
        : [`${key}:`, ...inner.map((line) => `  ${line}`)]
    })
  }
  return [String(value)]
}

export function readableValue(value: unknown): string {
  return lines(value).join('\n')
}
