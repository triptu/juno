/**
 * Composer text → what Slack accepts on send.
 *
 * The composer sends plain text with the people, user groups and channels
 * its suggestions picked already encoded as `<@U…|Maya>`,
 * `<!subteam^S…|@design-team>` and `<#C…|eng>`
 * (`encodeMentions` in `@juno/domain`), "> " quote lines, ":shortcode:"
 * emoji, and Slack's markup for styles and code (`markup.ts`). An edit's text names them as "@Maya Chen" and "#eng" instead, with
 * `MentionTargets` saying who they are. This turns either into one
 * `rich_text` block (sections, quotes and code blocks) and a mrkdwn `text` fallback with
 * `<@U…>` / `<!subteam^S…>` / `<#C…|name>` encodings. A group goes as
 * Slack's client sends it (research section 3, "User groups"): a
 * `usergroup` element and the bare `<!subteam^S…>`.
 *
 * Links go the way Slack's client sends them (research section 5): a URL
 * typed with its scheme is `{ type: "link", url }` and `<url>`; an address
 * or a bare domain gets its scheme and keeps what was typed as `text`
 * (`<http://example.com|example.com>`); a link the composer put on some
 * words arrives as `<url|label>` and goes as `{ type: "link", url, text }`.
 */
import type { RichTextBlock, RichTextElement, RichTextInline, RichTextStyle } from '@juno/slack-schema'
import { emojiUnicode, isKnownEmoji } from './emoji'
import { unescapeMrkdwn } from './from-mrkdwn'
import { findLinks } from './links'
import { lineMarkup, markupPieces } from './markup'

export interface MentionTargets {
  /** People the composer may have inserted, with their display name. */
  readonly people?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** Channels the composer may have inserted, by name without "#". */
  readonly channels?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** Custom emoji names the workspace knows. Shortcodes in the table are always converted. */
  readonly customEmoji?: (name: string) => boolean
  /** Links on words the edited message had: where `text` stands in an edit, it links to `url` again. */
  readonly links?: ReadonlyArray<{ readonly text: string; readonly url: string }>
}

export interface OutgoingMessage {
  readonly blocks: ReadonlyArray<RichTextBlock>
  readonly text: string
}

type Token =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'user'; readonly id: string; readonly name: string }
  | { readonly kind: 'usergroup'; readonly id: string }
  | { readonly kind: 'channel'; readonly id: string; readonly name: string }
  | { readonly kind: 'broadcast'; readonly range: 'here' | 'channel' | 'everyone' }
  | { readonly kind: 'emoji'; readonly name: string }
  | { readonly kind: 'link'; readonly url: string; readonly text?: string }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const EMOJI_RE = /:([a-z0-9_+\-']+(?:::skin-tone-[2-6])?):/g

/**
 * A person, group or channel the composer picked, or a link it put on some words,
 * as it sends them. The name is what the field showed; a link's label is
 * escaped as in mrkdwn (`encodeLinks` in `@juno/domain`).
 */
const WIRE_TOKEN = /<@([UW][A-Z0-9]+)(?:\|([^>]*))?>|<#([CG][A-Z0-9]+)(?:\|([^>]*))?>|<((?:https?:\/\/|mailto:)[^|>\s]+)\|([^>]+)>|<!subteam\^([A-Z0-9]+)(?:\|[^>]*)?>/g

function tokenizeLine(line: string, targets: MentionTargets): Token[] {
  const out: Token[] = []
  let last = 0
  for (const m of line.matchAll(WIRE_TOKEN)) {
    if (m.index > last) out.push(...tokenizeLinks(line.slice(last, m.index), targets))
    if (m[1] !== undefined) out.push({ kind: 'user', id: m[1], name: m[2] ?? m[1] })
    else if (m[3] !== undefined) out.push({ kind: 'channel', id: m[3], name: m[4] ?? m[3] })
    else if (m[7] !== undefined) out.push({ kind: 'usergroup', id: m[7] })
    else out.push({ kind: 'link', url: m[5]!, text: unescapeMrkdwn(m[6]!) })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(...tokenizeLinks(line.slice(last), targets))
  return out
}

/** The URLs, addresses and domains in `line`, and an edit's linked words, before mentions and emoji are looked for. */
function tokenizeLinks(line: string, targets: MentionTargets): Token[] {
  const found: Array<{ readonly start: number; readonly end: number; readonly token: Token }> = findLinks(line).map((link) => ({
    start: link.start,
    end: link.end,
    token: link.hasScheme ? { kind: 'link', url: link.url } : { kind: 'link', url: link.url, text: link.text },
  }))
  // Longest first, so a longer label wins where two overlap.
  for (const target of [...(targets.links ?? [])].sort((a, b) => b.text.length - a.text.length)) {
    if (target.text.trim() === '') continue
    for (let at = line.indexOf(target.text); at >= 0; at = line.indexOf(target.text, at + target.text.length)) {
      const end = at + target.text.length
      if (found.some((f) => at < f.end && end > f.start)) continue
      found.push({ start: at, end, token: target.text === target.url ? { kind: 'link', url: target.url } : { kind: 'link', url: target.url, text: target.text } })
    }
  }
  found.sort((a, b) => a.start - b.start)
  const out: Token[] = []
  let last = 0
  for (const f of found) {
    if (f.start > last) out.push(...tokenizeText(line.slice(last, f.start), targets))
    out.push(f.token)
    last = f.end
  }
  if (last < line.length) out.push(...tokenizeText(line.slice(last), targets))
  return out
}

function tokenizeText(line: string, targets: MentionTargets): Token[] {
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

/** The elements the composer sends, each of which can carry a style. */
type Sent = Exclude<RichTextInline, { readonly type: 'color' | 'unknown' }>

function toElement(token: Token): Sent {
  switch (token.kind) {
    case 'text':
      return { type: 'text', text: token.text }
    case 'user':
      return { type: 'user', user_id: token.id }
    case 'usergroup':
      return { type: 'usergroup', usergroup_id: token.id }
    case 'channel':
      return { type: 'channel', channel_id: token.id }
    case 'broadcast':
      return { type: 'broadcast', range: token.range }
    case 'emoji': {
      const unicode = emojiUnicode(token.name)
      return unicode === undefined ? { type: 'emoji', name: token.name } : { type: 'emoji', name: token.name, unicode: hexOf(unicode) }
    }
    case 'link':
      return token.text === undefined ? { type: 'link', url: token.url } : { type: 'link', url: token.url, text: token.text }
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
    case 'usergroup':
      return `<!subteam^${token.id}>`
    case 'channel':
      return `<#${token.id}|${token.name}>`
    case 'broadcast':
      return `<!${token.range}>`
    case 'emoji':
      return `:${token.name}:`
    case 'link':
      return token.text === undefined ? `<${escapeText(token.url)}>` : `<${escapeText(token.url)}|${escapeText(token.text)}>`
  }
}

/** Joins consecutive element lists with a newline text element between them. */
function joinLines(lines: ReadonlyArray<ReadonlyArray<RichTextInline>>): RichTextInline[] {
  const out: RichTextInline[] = []
  lines.forEach((line, i) => {
    if (i > 0) {
      const last = out[out.length - 1]
      if (last && last.type === 'text' && !last.style) out[out.length - 1] = { ...last, text: last.text + '\n' }
      else out.push({ type: 'text', text: '\n' })
    }
    for (const el of line) {
      const last = out[out.length - 1]
      if (el.type === 'text' && last && last.type === 'text' && styleKey(el.style) === styleKey(last.style)) out[out.length - 1] = { ...last, text: last.text + el.text }
      else out.push(el)
    }
  })
  return out
}

type Style = { bold?: true; italic?: true; strike?: true; code?: true }
const STYLES = ['bold', 'italic', 'strike', 'code'] as const
const styleKey = (style: RichTextStyle | undefined) => (style === undefined ? '' : STYLES.filter((name) => style[name]).join('+'))

/**
 * A line's elements with its markup applied (`lineMarkup`): the markers go,
 * and each text run, mention, link and emoji takes the styles around it.
 * The parser reads each mention, link and emoji as one opaque character.
 * In code an emoji stays its shortcode, as Slack shows it there.
 */
function styledElements(tokens: ReadonlyArray<Token>): RichTextInline[] {
  let line = ''
  const owner: number[] = []
  tokens.forEach((token, index) => {
    const text = token.kind === 'text' ? token.text : '\uFFFC'
    line += text
    for (let i = 0; i < text.length; i++) owner.push(index)
  })
  const { spans, markers } = lineMarkup(line)
  const styles: Array<Style | undefined> = Array.from({ length: line.length }, () => undefined)
  // Keys in one order, whatever order the markers opened in.
  for (const span of spans) for (let i = span.start; i < span.end; i++) styles[i] = { ...styles[i], [span.style]: true }
  const ordered = (style: Style | undefined): Style | undefined => {
    if (style === undefined) return undefined
    const out: Style = {}
    for (const name of STYLES) if (style[name]) out[name] = true
    return out
  }
  const dropped = new Uint8Array(line.length)
  for (const marker of markers) dropped.fill(1, marker.start, marker.end)
  const out: RichTextInline[] = []
  for (let i = 0; i < line.length; i++) {
    if (dropped[i] === 1) continue
    const token = tokens[owner[i]!]!
    const style = ordered(styles[i])
    const element: Sent = token.kind === 'text' ? { type: 'text', text: line[i]! } : token.kind === 'emoji' && style?.code === true ? { type: 'text', text: `:${token.name}:` } : toElement(token)
    const last = out[out.length - 1]
    if (element.type === 'text' && last?.type === 'text' && styleKey(last.style) === styleKey(style)) {
      out[out.length - 1] = { ...last, text: last.text + element.text }
      continue
    }
    out.push(style === undefined ? element : { ...element, style })
  }
  return out
}

/** Text in a code block: only what the composer encoded (picked mentions, linked words) is an element. */
function codeElements(code: string): { readonly elements: RichTextInline[]; readonly mrkdwn: string } {
  const tokens: Token[] = []
  let last = 0
  for (const m of code.matchAll(WIRE_TOKEN)) {
    if (m.index > last) tokens.push({ kind: 'text', text: code.slice(last, m.index) })
    tokens.push(...tokenizeLine(m[0], {}))
    last = m.index + m[0].length
  }
  if (last < code.length) tokens.push({ kind: 'text', text: code.slice(last) })
  return { elements: tokens.map(toElement), mrkdwn: tokens.map(toMrkdwn).join('') }
}

/**
 * Converts composer text. Empty or whitespace-only input gives no blocks
 * and an empty `text`, which callers treat as "nothing to send".
 *
 * Slack's markup is sent as Slack's client sends it with "Format messages
 * with markup" on (`markup.ts`, research section 5): styled runs as `text`,
 * mention, link and emoji elements with a `style`, code blocks as
 * `rich_text_preformatted` with `border: 0`, and "> " lines as
 * `rich_text_quote`. The `text` fallback keeps the markup as typed, and a
 * code block as "```code```".
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

  for (const piece of markupPieces(text)) {
    if (piece.kind === 'code') {
      flushSection()
      flushQuote()
      const code = codeElements(text.slice(piece.content.start, piece.content.end))
      elements.push({ type: 'rich_text_preformatted', elements: code.elements, border: 0 })
      mrkdwnLines.push(`\`\`\`${code.mrkdwn}\`\`\``)
      continue
    }
    const line = text.slice(piece.quote?.end ?? piece.start, piece.end)
    const tokens = tokenizeLine(line, targets)
    const els = styledElements(tokens)
    const mrkdwn = tokens.map(toMrkdwn).join('')
    if (piece.quote !== undefined) {
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
