/**
 * Slack mrkdwn `text` → `MessageBody`.
 *
 * The incoming text is HTML-escaped (`&lt; &gt; &amp;`) and uses Slack's
 * angle-bracket encodings for mentions and links. Formatting markers are
 * `*bold*`, `_italic_`, `~strike~`, `` `code` `` and fenced ``` blocks.
 * Lines that start with `&gt;` are quotes.
 */
import type { Block, Inline, InlineStyle, Lookups } from './model'
import { channelInline, dateInline, emojiInline, normalize, usergroupInline, userInline } from './inline'

export function unescapeMrkdwn(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** Inline parser state: a cursor over one line (no newlines inside). */
function parseAngle(escaped: string, lookups: Lookups): Inline {
  // Slack escapes inside the brackets too: a link's `&` arrives as `&amp;`, a label's `>` as `&gt;`.
  const content = unescapeMrkdwn(escaped)
  // <@U123>, <@U123|name>
  let m = /^@([A-Z0-9]+)(?:\|(.*))?$/.exec(content)
  if (m && m[1] !== undefined) return userInline(m[1], lookups, m[2] || undefined)
  // <#C123|name>, <#C123>
  m = /^#([A-Z0-9]+)(?:\|(.*))?$/.exec(content)
  if (m && m[1] !== undefined) return channelInline(m[1], m[2] || undefined, lookups)
  // <!subteam^S123|@handle>
  m = /^!subteam\^([A-Z0-9]+)(?:\|@?(.*))?$/.exec(content)
  if (m && m[1] !== undefined) return usergroupInline(m[1], m[2] || undefined, lookups)
  // <!here>, <!channel>, <!everyone>, optionally with |label
  m = /^!(here|channel|everyone)(?:\|.*)?$/.exec(content)
  if (m && (m[1] === 'here' || m[1] === 'channel' || m[1] === 'everyone')) return { kind: 'broadcast', range: m[1] }
  // <!date^1392734382^{date_short}|fallback>
  m = /^!date\^(\d+)\^([^|^]*)(?:\^([^|]*))?\|(.*)$/.exec(content)
  if (m && m[1] !== undefined && m[2] !== undefined) return dateInline(Number(m[1]), m[2], m[4], m[3])
  // Other special tokens: <!sf:…> and unknown. Show the label if any.
  if (content.startsWith('!')) {
    const bar = content.indexOf('|')
    return { kind: 'text', text: bar >= 0 ? content.slice(bar + 1) : '' }
  }
  // <url|label>, <url>, <mailto:a@b|a@b>
  const bar = content.indexOf('|')
  const url = bar >= 0 ? content.slice(0, bar) : content
  const label = bar >= 0 ? content.slice(bar + 1) : url
  return { kind: 'link', url, text: label }
}

const EMOJI_RE = /^:([a-z0-9_+\-']+(?:::skin-tone-[2-6])?):/

function isBoundaryBefore(text: string, i: number): boolean {
  if (i === 0) return true
  const c = text[i - 1] ?? ''
  return /[\s([{"'“‘>]/.test(c)
}

function isBoundaryAfter(text: string, i: number): boolean {
  if (i >= text.length) return true
  const c = text[i] ?? ''
  return /[\s)\]}.,;:!?"'”’<]/.test(c)
}

function findClosing(text: string, marker: string, from: number): number {
  let i = from
  while (i < text.length) {
    const j = text.indexOf(marker, i)
    if (j < 0) return -1
    const prev = text[j - 1] ?? ''
    if (!/\s/.test(prev) && isBoundaryAfter(text, j + 1)) return j
    i = j + 1
  }
  return -1
}

function withStyle(style: InlineStyle | undefined, key: keyof InlineStyle): InlineStyle {
  return { ...style, [key]: true }
}

function applyStyle(inlines: Inline[], style: InlineStyle | undefined): Inline[] {
  if (!style) return inlines
  return inlines.map((inline) => {
    if (inline.kind === 'text' || inline.kind === 'link') {
      const merged = { ...style, ...inline.style }
      return { ...inline, style: merged }
    }
    return inline
  })
}

/** Parses one line of mrkdwn into inlines. */
function parseLine(line: string, lookups: Lookups, style: InlineStyle | undefined): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf.length > 0) {
      out.push(style ? { kind: 'text', text: unescapeMrkdwn(buf), style } : { kind: 'text', text: unescapeMrkdwn(buf) })
      buf = ''
    }
  }
  let i = 0
  while (i < line.length) {
    const c = line[i] ?? ''
    if (c === '<') {
      const end = line.indexOf('>', i + 1)
      if (end > i + 1) {
        flush()
        out.push(...applyStyle([parseAngle(line.slice(i + 1, end), lookups)], style))
        i = end + 1
        continue
      }
    }
    if (c === '`') {
      const end = line.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ kind: 'text', text: unescapeMrkdwn(line.slice(i + 1, end)), style: withStyle(style, 'code') })
        i = end + 1
        continue
      }
    }
    if (c === ':') {
      const m = EMOJI_RE.exec(line.slice(i))
      if (m && m[1] !== undefined && isBoundaryBefore(line, i)) {
        flush()
        out.push(emojiInline(m[1], lookups))
        i += m[0].length
        continue
      }
    }
    if ((c === '*' || c === '_' || c === '~') && isBoundaryBefore(line, i) && !/\s/.test(line[i + 1] ?? ' ')) {
      const end = findClosing(line, c, i + 1)
      if (end > i + 1) {
        flush()
        const key: keyof InlineStyle = c === '*' ? 'bold' : c === '_' ? 'italic' : 'strike'
        out.push(...parseLine(line.slice(i + 1, end), lookups, withStyle(style, key)))
        i = end + 1
        continue
      }
    }
    buf += c
    i++
  }
  flush()
  return out
}

/** Inline parse of mrkdwn that may contain newlines. Quotes and code fences are not split out. */
export function mrkdwnInlines(text: string, lookups: Lookups = {}): Inline[] {
  const out: Inline[] = []
  text.split('\n').forEach((line, i) => {
    if (i > 0) out.push({ kind: 'break' })
    out.push(...parseLine(line, lookups, undefined))
  })
  return normalize(out)
}

const QUOTE_RE = /^(?:&gt;|>)\s?/

/** Block parse of mrkdwn: paragraphs, quote runs and fenced code. */
export function mrkdwnBlocks(text: string, lookups: Lookups = {}): Block[] {
  const blocks: Block[] = []
  const lines = text.split('\n')
  let paragraph: Inline[] = []
  let quote: Inline[] = []

  const flushParagraph = () => {
    const children = normalize(paragraph)
    if (children.length > 0) blocks.push({ kind: 'paragraph', children })
    paragraph = []
  }
  const flushQuote = () => {
    const children = normalize(quote)
    if (children.length > 0) blocks.push({ kind: 'quote', children })
    quote = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    // Fenced code: ``` on its own line or inline with content on the first line.
    if (line.trimStart().startsWith('```')) {
      flushParagraph()
      flushQuote()
      const first = line.trimStart().slice(3)
      const codeLines: string[] = []
      if (first.includes('```')) {
        codeLines.push(first.slice(0, first.indexOf('```')))
      } else {
        if (first.length > 0) codeLines.push(first)
        i++
        while (i < lines.length) {
          const l = lines[i] ?? ''
          const close = l.indexOf('```')
          if (close >= 0) {
            if (close > 0) codeLines.push(l.slice(0, close))
            break
          }
          codeLines.push(l)
          i++
        }
      }
      const code = unescapeMrkdwn(codeLines.join('\n')).replace(/^\n+|\n+$/g, '')
      if (code.length > 0) blocks.push({ kind: 'code', text: code })
      i++
      continue
    }
    if (QUOTE_RE.test(line)) {
      flushParagraph()
      if (quote.length > 0) quote.push({ kind: 'break' })
      quote.push(...parseLine(line.replace(QUOTE_RE, ''), lookups, undefined))
      i++
      continue
    }
    flushQuote()
    if (paragraph.length > 0) paragraph.push({ kind: 'break' })
    paragraph.push(...parseLine(line, lookups, undefined))
    i++
  }
  flushParagraph()
  flushQuote()
  return blocks
}
