/**
 * The developer log's text rules (`devLog.ts`): the one place that removes
 * secrets, cuts values short and summarises a Slack response. Everything an
 * entry keeps passes through `clean`; what people wrote (a message's or a
 * draft's text and blocks) is kept only as its length (`cleanParam`).
 */

/** A value is cut to this many characters. */
export const VALUE_CHARS = 300
/** Params and summary lines an entry keeps, each. */
export const MAX_LINES = 40
/** All the text of one entry together, labels included. */
export const ENTRY_CHARS = 4000

const REMOVED = '[removed]'

/** Field names whose values are never kept. */
const SECRET_NAME = /token|cookie|secret|password|passwd|authorization|^d$|^d-s$|^x-?api-?key$/i

/**
 * Slack tokens (`xoxc-`, `xoxd-`, `xoxp-` and the rest), a `d` or `d-s`
 * cookie pair, bearer credentials and `sk-` keys, wherever they sit in a
 * value. Slack's `xoxd` cookie value is often URL-encoded, so `%` counts as
 * part of it.
 */
const SECRET_VALUES: ReadonlyArray<readonly [RegExp, string]> = [
  [/xox[a-z]-[A-Za-z0-9%._~+/=-]+/gi, REMOVED],
  [/\b(d|d-s)=[^;\s&"']+/g, `$1=${REMOVED}`],
  [/Bearer\s+\S+/gi, `Bearer ${REMOVED}`],
  [/sk-[A-Za-z0-9_-]{8,}/g, REMOVED],
]

/** `text` with every secret removed and cut to `max` characters, with an ellipsis when cut. */
export function clean(text: string, max = VALUE_CHARS): string {
  let out = text
  for (const [pattern, replacement] of SECRET_VALUES) out = out.replace(pattern, replacement)
  return out.length > max ? `${out.slice(0, max - 1)}…` : out
}

export interface Line {
  readonly label: string
  readonly value: string
}

/** A named value as the log keeps it: removed outright when the name says secret, else cleaned. */
export function cleanLine(label: string, value: string): Line {
  return { label: clean(label, 80), value: SECRET_NAME.test(label) ? REMOVED : clean(value) }
}

/** Request fields that carry what someone wrote: a message's or a draft's text and blocks. */
const CONTENT_NAME = /^(text|blocks|markdown_text|comment|attachments)$/

/** A request field as the log keeps it: what someone wrote only by its length, anything else as `cleanLine`. */
export function cleanParam(label: string, value: string): Line {
  return CONTENT_NAME.test(label) ? { label: clean(label, 80), value: `[${value.length} characters]` } : cleanLine(label, value)
}

/**
 * At most `MAX_LINES` lines, and no more than `budget` characters between
 * them. What is left out is counted on a last line.
 */
export function capLines(lines: ReadonlyArray<Line>, budget = ENTRY_CHARS): ReadonlyArray<Line> {
  const kept: Array<Line> = []
  let used = 0
  for (const line of lines) {
    const size = line.label.length + line.value.length
    if (kept.length >= MAX_LINES || used + size > budget) break
    kept.push(line)
    used += size
  }
  const left = lines.length - kept.length
  return left === 0 ? kept : [...kept, { label: '…', value: `${left} more` }]
}

const describeValue = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    return `{ ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? `, … ${keys.length - 8} more` : ''} }`
  }
  if (typeof value === 'string') return JSON.stringify(clean(value, 80))
  return String(value)
}

/**
 * A short shape of a Slack response: each top-level key with its value or
 * shape (array lengths, an object's keys), and the paging fields first:
 * `has_more` and `response_metadata.next_cursor`. Only the top level is
 * read, so a large `client.userBoot` costs no more than a small answer.
 */
export function summarise(json: unknown): ReadonlyArray<Line> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return [cleanLine('body', describeValue(json))]
  const body = json as Record<string, unknown>
  const lines: Array<Line> = []
  if ('has_more' in body) lines.push(cleanLine('has_more', String(body.has_more)))
  const meta = body.response_metadata
  const cursor = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>).next_cursor : undefined
  if (typeof cursor === 'string') lines.push(cleanLine('next_cursor', cursor === '' ? '(none)' : clean(cursor, 60)))
  for (const [key, value] of Object.entries(body)) {
    if (key === 'has_more') continue
    lines.push(cleanLine(key, describeValue(value)))
  }
  return lines
}
