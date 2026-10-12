/**
 * Composer text → what Slack accepts on send.
 *
 * The composer holds plain text with "@Maya Chen" and "#eng" tokens that the
 * suggestion popover inserted, "> " quote lines, and ":shortcode:" emoji.
 * This turns that into one `rich_text` block (sections and quotes) and a
 * mrkdwn `text` fallback with `<@U…>` / `<#C…|name>` encodings.
 */
import type { RichTextBlock, RichTextElement, RichTextInline } from '@juno/slack-schema'
import { emojiUnicode, isKnownEmoji } from './emoji'

export interface MentionTargets {
  /** People the composer may have inserted, with their display name. */
  readonly people?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** Channels the composer may have inserted, by name without "#". */
  readonly channels?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** Custom emoji names the workspace knows. Shortcodes in the table are always converted. */
  readonly customEmoji?: (name: string) => boolean
}

export interface OutgoingMessage {
  readonly blocks: ReadonlyArray<RichTextBlock>
  readonly text: string
}

type Token =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'user'; readonly id: string; readonly name: string }
  | { readonly kind: 'channel'; readonly id: string; readonly name: string }
  | { readonly kind: 'broadcast'; readonly range: 'here' | 'channel' | 'everyone' }
  | { readonly kind: 'emoji'; readonly name: string }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const EMOJI_RE = /:([a-z0-9_+\-']+(?:::skin-tone-[2-6])?):/g

function tokenizeLine(line: string, targets: MentionTargets): Token[] {
  const names: Array<{ readonly text: string; readonly token: Token }> = []
  for (const p of targets.people ?? []) {
    names.push({ text: `@${p.name}`, token: { kind: 'user', id: p.id, name: p.name } })
    const first = p.name.split(/\s+/)[0]
    if (first && first !== p.name) names.push({ text: `@${first}`, token: { kind: 'user', id: p.id, name: p.name } })
  }
  for (const c of targets.channels ?? []) names.push({ text: `#${c.name}`, token: { kind: 'channel', id: c.id, name: c.name } })
  for (const range of ['here', 'channel', 'everyone'] as const) names.push({ text: `@${range}`, token: { kind: 'broadcast', range } })
  // Longest first, so "@Maya Chen" wins over "@Maya".
  names.sort((a, b) => b.text.length - a.text.length)
  // Two people with the same first name: the first listed wins (callers pass recency order).
  const byText = new Map<string, Token>()
  for (const n of names) {
    const key = n.text.toLowerCase()
    if (!byText.has(key)) byText.set(key, n.token)
  }
  const out: Token[] = []
  if (names.length === 0) {
    out.push({ kind: 'text', text: line })
  } else {
    const re = new RegExp(`(${names.map((n) => escapeRegExp(n.text)).join('|')})(?![\\w-])`, 'gi')
    let last = 0
    for (const m of line.matchAll(re)) {
      const start = m.index
      const matched = m[0]
      // Only at a word start: not inside an email or a word.
      const before = line[start - 1] ?? ' '
      if (/[\w@#-]/.test(before)) continue
      if (start > last) out.push({ kind: 'text', text: line.slice(last, start) })
      const token = byText.get(matched.toLowerCase())
      out.push(token ?? { kind: 'text', text: matched })
      last = start + matched.length
    }
    if (last < line.length) out.push({ kind: 'text', text: line.slice(last) })
  }
  // Emoji shortcodes inside text tokens.
  const final: Token[] = []
  for (const token of out) {
    if (token.kind !== 'text') {
      final.push(token)
      continue
    }
    let cursor = 0
    for (const m of token.text.matchAll(EMOJI_RE)) {
      const name = m[1]
      if (name === undefined) continue
      const known = isKnownEmoji(name) || targets.customEmoji?.(name.replace(/::skin-tone-[2-6]$/, '')) === true
      if (!known) continue
      const before = token.text[m.index - 1] ?? ' '
      if (/[\w]/.test(before)) continue
      if (m.index > cursor) final.push({ kind: 'text', text: token.text.slice(cursor, m.index) })
      final.push({ kind: 'emoji', name })
      cursor = m.index + m[0].length
    }
    if (cursor < token.text.length) final.push({ kind: 'text', text: token.text.slice(cursor) })
  }
  return final
}

function toElement(token: Token): RichTextInline {
  switch (token.kind) {
    case 'text':
      return { type: 'text', text: token.text }
    case 'user':
      return { type: 'user', user_id: token.id }
    case 'channel':
      return { type: 'channel', channel_id: token.id }
    case 'broadcast':
      return { type: 'broadcast', range: token.range }
    case 'emoji': {
      const unicode = emojiUnicode(token.name)
      return unicode === undefined ? { type: 'emoji', name: token.name } : { type: 'emoji', name: token.name, unicode: hexOf(unicode) }
    }
  }
}

function hexOf(unicode: string): string {
  return Array.from(unicode)
    .map((ch) => (ch.codePointAt(0) ?? 0).toString(16))
    .join('-')
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function toMrkdwn(token: Token): string {
  switch (token.kind) {
    case 'text':
      return escapeText(token.text)
    case 'user':
      return `<@${token.id}>`
    case 'channel':
      return `<#${token.id}|${token.name}>`
    case 'broadcast':
      return `<!${token.range}>`
    case 'emoji':
      return `:${token.name}:`
  }
}

/** Joins consecutive element lists with a newline text element between them. */
function joinLines(lines: ReadonlyArray<ReadonlyArray<RichTextInline>>): RichTextInline[] {
  const out: RichTextInline[] = []
  lines.forEach((line, i) => {
    if (i > 0) {
      const last = out[out.length - 1]
      if (last && last.type === 'text') out[out.length - 1] = { ...last, text: last.text + '\n' }
      else out.push({ type: 'text', text: '\n' })
    }
    for (const el of line) {
      const last = out[out.length - 1]
      if (el.type === 'text' && last && last.type === 'text' && !el.style && !last.style) out[out.length - 1] = { ...last, text: last.text + el.text }
      else out.push(el)
    }
  })
  return out
}

const QUOTE_LINE = /^>\s?/

/**
 * Converts composer text. Empty or whitespace-only input gives no blocks
 * and an empty `text`, which callers treat as "nothing to send".
 */
export function composeOutgoing(input: string, targets: MentionTargets = {}): OutgoingMessage {
  const text = input.replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  if (text.trim().length === 0) return { blocks: [], text: '' }

  const elements: RichTextElement[] = []
  const mrkdwnLines: string[] = []
  let section: RichTextInline[][] = []
  let quote: RichTextInline[][] = []

  const flushSection = () => {
    if (section.length > 0) elements.push({ type: 'rich_text_section', elements: joinLines(section) })
    section = []
  }
  const flushQuote = () => {
    if (quote.length > 0) elements.push({ type: 'rich_text_quote', elements: joinLines(quote) })
    quote = []
  }

  for (const rawLine of text.split('\n')) {
    const isQuote = QUOTE_LINE.test(rawLine)
    const line = isQuote ? rawLine.replace(QUOTE_LINE, '') : rawLine
    const tokens = tokenizeLine(line, targets)
    const els = tokens.map(toElement)
    const mrkdwn = tokens.map(toMrkdwn).join('')
    if (isQuote) {
      flushSection()
      quote.push(els)
      mrkdwnLines.push(`&gt; ${mrkdwn}`)
    } else {
      flushQuote()
      section.push(els)
      mrkdwnLines.push(mrkdwn)
    }
  }
  flushSection()
  flushQuote()

  return {
    blocks: [{ type: 'rich_text', elements }],
    text: mrkdwnLines.join('\n'),
  }
}
