/**
 * A Markdown file as a `MessageBody`, for the media viewer's text items
 * (SPEC section 8, "Other files"). It reads the common CommonMark and GitHub
 * forms: ATX and setext headings, paragraphs, `>` quotes, `-`, `*`, `+`,
 * `1.` and task lists, fenced code with its language, rules, and inline
 * `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)`,
 * `<url>` and bare links. Anything else (tables, HTML, footnotes) stays as
 * its text. Images become links to their url, so nothing is fetched.
 */
import { findLinks } from './links'
import type { ContentBlock, Inline, InlineStyle, ListStyle, MessageBody } from './model'

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/
const HEADING = /^ {0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/
const SETEXT = /^ {0,3}(=+|-+)\s*$/

export function bodyFromMarkdown(markdown: string): MessageBody {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Array<ContentBlock> = []
  let paragraph: Array<string> = []
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', children: markdownInlines(paragraph.join(' ')) })
    paragraph = []
  }
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!
    const fence = FENCE.exec(line)
    if (fence !== null) {
      flush()
      const marker = fence[1]!
      const code: Array<string> = []
      for (at++; at < lines.length && !lines[at]!.trimStart().startsWith(marker); at++) code.push(lines[at]!)
      blocks.push({ kind: 'code', text: code.join('\n'), ...(fence[2] ? { language: fence[2] } : {}) })
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    const setext = paragraph.length > 0 ? SETEXT.exec(line) : null
    if (setext !== null) {
      blocks.push({ kind: 'heading', children: markdownInlines(paragraph.join(' ')) })
      paragraph = []
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      flush()
      blocks.push({ kind: 'heading', children: markdownInlines(heading[1] ?? '') })
      continue
    }
    if (RULE.test(line)) {
      flush()
      blocks.push({ kind: 'divider' })
      continue
    }
    const quote = QUOTE.exec(line)
    if (quote !== null) {
      flush()
      const quoted = [quote[1]!]
      while (at + 1 < lines.length && QUOTE.test(lines[at + 1]!)) quoted.push(QUOTE.exec(lines[++at]!)![1]!)
      const children: Array<Inline> = []
      quoted.forEach((part, index) => {
        if (index > 0) children.push({ kind: 'break' })
        children.push(...markdownInlines(part))
      })
      blocks.push({ kind: 'quote', children })
      continue
    }
    const item = ITEM.exec(line)
    if (item !== null) {
      flush()
      const indent = Math.floor(item[1]!.replace(/\t/g, '    ').length / 2)
      const style: ListStyle = item[3] === undefined ? (/\d/.test(item[2]!) ? 'ordered' : 'bullet') : item[3] === ' ' ? 'unchecked' : 'checked'
      const last = blocks[blocks.length - 1]
      const children = markdownInlines(item[4]!)
      if (last?.kind === 'list' && last.style === style && last.indent === indent) blocks[blocks.length - 1] = { ...last, items: [...last.items, children] }
      else blocks.push({ kind: 'list', style, indent, items: [children] })
      continue
    }
    paragraph.push(line.trim())
  }
  flush()
  return { blocks }
}

const PUNCTUATION = /[!-/:-@[-`{-~]/

/** Markdown's inline forms in one line of text. */
export function markdownInlines(text: string, style: InlineStyle = {}): Array<Inline> {
  const out: Array<Inline> = []
  let plain = ''
  const pushPlain = () => {
    if (plain === '') return
    let from = 0
    for (const link of findLinks(plain)) {
      if (link.start > from) out.push(textInline(plain.slice(from, link.start), style))
      out.push(linkInline(link.url, link.text, style))
      from = link.end
    }
    if (from < plain.length) out.push(textInline(plain.slice(from), style))
    plain = ''
  }
  let at = 0
  while (at < text.length) {
    const char = text[at]!
    const rest = text.slice(at)
    if (char === '\\' && PUNCTUATION.test(text[at + 1] ?? '')) {
      plain += text[at + 1]
      at += 2
      continue
    }
    if (char === '`') {
      const run = /^`+/.exec(rest)![0]
      const close = text.indexOf(run, at + run.length)
      if (close !== -1) {
        pushPlain()
        out.push(textInline(text.slice(at + run.length, close).trim() || ' ', { ...style, code: true }))
        at = close + run.length
        continue
      }
    }
    const link = /^!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest)
    if (link !== null && /^(?:https?:|mailto:)/i.test(link[2]!)) {
      pushPlain()
      out.push(linkInline(link[2]!, link[1] || link[2]!, style))
      at += link[0].length
      continue
    }
    const auto = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/i.exec(rest)
    if (auto !== null) {
      pushPlain()
      out.push(linkInline(auto[1]!, auto[1]!, style))
      at += auto[0].length
      continue
    }
    const marker = /^(\*\*|__|~~|\*|_)/.exec(rest)?.[1]
    if (marker !== undefined && opens(text, at, marker)) {
      const close = closing(text, at + marker.length, marker)
      if (close !== -1) {
        pushPlain()
        const next: InlineStyle = marker === '~~' ? { ...style, strike: true } : marker.length === 2 ? { ...style, bold: true } : { ...style, italic: true }
        out.push(...markdownInlines(text.slice(at + marker.length, close), next))
        at = close + marker.length
        continue
      }
    }
    plain += char
    at++
  }
  pushPlain()
  return out
}

/** A marker opens with text right after it, and `_` only at a word's start. */
function opens(text: string, at: number, marker: string): boolean {
  const after = text[at + marker.length]
  if (after === undefined || /\s/.test(after)) return false
  return !(marker[0] === '_' && at > 0 && /[\p{L}\p{N}]/u.test(text[at - 1]!))
}

/** The nearest same marker with text right before it, and for `_` no letter after it. */
function closing(text: string, from: number, marker: string): number {
  for (let at = text.indexOf(marker, from + 1); at !== -1; at = text.indexOf(marker, at + 1)) {
    if (/\s/.test(text[at - 1]!)) continue
    if (marker.length === 1 && text[at + 1] === marker) {
      at++
      continue
    }
    if (marker[0] === '_' && /[\p{L}\p{N}]/u.test(text[at + marker.length] ?? '')) continue
    return at
  }
  return -1
}

function textInline(text: string, style: InlineStyle): Inline {
  return Object.keys(style).length === 0 ? { kind: 'text', text } : { kind: 'text', text, style }
}

function linkInline(url: string, text: string, style: InlineStyle): Inline {
  return Object.keys(style).length === 0 ? { kind: 'link', url, text } : { kind: 'link', url, text, style }
}
