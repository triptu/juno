/**
 * Finding links in plain text, as Slack's client does when it sends: a URL
 * with a scheme, an email address, or a bare domain like "example.com".
 * Slack's clients send every one as a `link` element (research section 5),
 * and Slack does not link text elements itself.
 */

/** Top-level domains a bare "name.tld" is linked for. A short list keeps "index.ts" and "v1.2" plain. */
const TLDS = [
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'io', 'dev', 'ai', 'app', 'co', 'me', 'info', 'biz', 'xyz', 'so', 'sh', 'ly', 'gg', 'tv', 'fm',
  'us', 'uk', 'ca', 'au', 'de', 'fr', 'nl', 'es', 'it', 'in', 'jp', 'cn', 'br', 'ru', 'ch', 'se', 'no', 'fi', 'dk', 'pl', 'eu', 'nz', 'ie', 'be',
  'at', 'il', 'kr', 'sg', 'hk', 'tech', 'cloud', 'site', 'online', 'page', 'link', 'blog', 'news', 'design', 'studio',
].join('|')

const DOMAIN = `(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?![a-z0-9-])`
const LINK_RE = new RegExp(
  [
    // A URL with a scheme.
    `(?:https?:\\/\\/|mailto:)[^\\s<>]+`,
    // An email address.
    `[a-z0-9._%+-]+@${DOMAIN}`,
    // A bare domain, with a port and a path.
    `${DOMAIN}(?::\\d{1,5})?(?:[/?#][^\\s<>]*)?`,
  ].join('|'),
  'gi',
)

/** What may not come right before a link: it would be the middle of a word, a path or an address. */
const NOT_BEFORE = /[\p{L}\p{N}_@./\-:]/u

export interface FoundLink {
  readonly start: number
  readonly end: number
  /** What to open: the text with a scheme added ("http://" for a domain, "mailto:" for an address). */
  readonly url: string
  /** The text as written. */
  readonly text: string
  /** The text had its own scheme: Slack's client sends such a link with no `text`. */
  readonly hasScheme: boolean
}

/** Drops punctuation that ends the sentence, not the URL, and a closing bracket the URL did not open. */
function trimEnd(url: string): string {
  let out = url
  for (;;) {
    const last = out[out.length - 1]
    if (last === undefined) return out
    if (/[.,;:!?'"’”*_~]/.test(last)) {
      out = out.slice(0, -1)
      continue
    }
    const pair = last === ')' ? '(' : last === ']' ? '[' : undefined
    if (pair !== undefined && out.split(pair).length <= out.split(last).length - 1) {
      out = out.slice(0, -1)
      continue
    }
    return out
  }
}

/** The links in `text`, in order. */
export function findLinks(text: string): ReadonlyArray<FoundLink> {
  const out: FoundLink[] = []
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index
    if (start > 0 && NOT_BEFORE.test(text[start - 1]!)) continue
    const found = trimEnd(m[0])
    // A scheme with nothing after it is not a link.
    if (/^(?:https?:\/\/|mailto:)$/i.test(found)) continue
    const hasScheme = /^(?:https?:\/\/|mailto:)/i.test(found)
    const url = hasScheme ? found : found.includes('@') && !found.includes('/') ? `mailto:${found}` : `http://${found}`
    out.push({ start, end: start + found.length, url, text: found, hasScheme })
  }
  return out
}

/** The URL `text` is, when all of it is one link (a paste over a selection). */
export function linkOf(text: string): string | undefined {
  const trimmed = text.trim()
  const [only] = findLinks(trimmed)
  return only !== undefined && only.start === 0 && only.end === trimmed.length ? only.url : undefined
}
