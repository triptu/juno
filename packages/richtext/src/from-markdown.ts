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
const SPACE = /\s/
const WORD = /[\p{L}\p{N}]/u
/** Emphasis inside emphasis this deep is read as text, so a line is scanned at most this many times. */
const MAX_DEPTH = 3
const MARKERS = ['**', '__', '~~', '*', '_'] as const
/** The longest link target or autolink read, so a far-off `)` or `>` is never read up to again and again. */
const MAX_TARGET = 2048

/**
 * Markdown's inline forms in one line of text, in one pass. Every search
 * ahead (a closing backtick run, `]`, `)`, `>` or emphasis marker) is
 * remembered, so a later search from inside the part already searched
 * answers at once: a line of unclosed brackets or markers stays linear.
 */
export function markdownInlines(text: string, style: InlineStyle = {}, depth = 0): Array<Inline> {
  const out: Array<Inline> = []
  const find = searcher(text)
  const close = closer(text)
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
    if (char === '\\' && PUNCTUATION.test(text[at + 1] ?? '')) {
      plain += text[at + 1]
      at += 2
      continue
    }
    if (char === '`') {
      let end = at
      while (text[end] === '`') end++
      const run = text.slice(at, end)
      const closed = find(run, end)
      if (closed === -1) {
        // The whole run is text: none of its shorter runs can close either.
        plain += run
        at = end
        continue
      }
      pushPlain()
      out.push(textInline(text.slice(end, closed).trim() || ' ', { ...style, code: true }))
      at = closed + run.length
      continue
    }
    const link = char === '[' || (char === '!' && text[at + 1] === '[') ? linkAt(text, char === '!' ? at + 1 : at, find) : undefined
    if (link !== undefined) {
      pushPlain()
      out.push(linkInline(link.url, link.label || link.url, style))
      at = link.end
      continue
    }
    if (char === '<') {
      const auto = autolinkAt(text, at, find)
      if (auto !== undefined) {
        pushPlain()
        out.push(linkInline(auto, auto, style))
        at += auto.length + 2
        continue
      }
    }
    const marker = depth < MAX_DEPTH ? MARKERS.find((each) => text.startsWith(each, at)) : undefined
    if (marker !== undefined && opens(text, at, marker)) {
      const closed = close(marker, at + marker.length)
      if (closed !== -1) {
        pushPlain()
        const next: InlineStyle = marker === '~~' ? { ...style, strike: true } : marker.length === 2 ? { ...style, bold: true } : { ...style, italic: true }
        out.push(...markdownInlines(text.slice(at + marker.length, closed), next, depth + 1))
        at = closed + marker.length
        continue
      }
    }
    plain += char
    at++
  }
  pushPlain()
  return out
}

/**
 * `text.indexOf(needle, from)` that remembers its last answer for each
 * needle: a search from inside the stretch it already searched answers
 * without scanning, so searches from a moving start scan the text once.
 */
function searcher(text: string): (needle: string, from: number) => number {
  const last = new Map<string, { readonly from: number; readonly at: number }>()
  return (needle, from) => {
    const hit = last.get(needle)
    if (hit !== undefined && from >= hit.from && (hit.at === -1 || from <= hit.at)) return hit.at
    const at = text.indexOf(needle, from)
    last.set(needle, { from, at })
    return at
  }
}

/** `[label](url)` or `[label](url "title")` with `[` at `open`, for an http, https or mailto url. */
function linkAt(text: string, open: number, find: (needle: string, from: number) => number): { readonly label: string; readonly url: string; readonly end: number } | undefined {
  const bracket = find(']', open + 1)
  if (bracket === -1 || text[bracket + 1] !== '(') return undefined
  const paren = find(')', bracket + 2)
  if (paren === -1 || paren - bracket > MAX_TARGET) return undefined
  const inside = /^\s*<?([^\s>]+)>?(?:\s+"[^"]*")?\s*$/.exec(text.slice(bracket + 2, paren))
  const url = inside?.[1]
  if (url === undefined || !/^(?:https?:|mailto:)/i.test(url)) return undefined
  return { label: text.slice(open + 1, bracket), url, end: paren + 1 }
}

/** The url of `<https://…>` or `<mailto:…>` at `at`. */
function autolinkAt(text: string, at: number, find: (needle: string, from: number) => number): string | undefined {
  const end = find('>', at + 1)
  if (end === -1 || end - at > MAX_TARGET) return undefined
  const url = text.slice(at + 1, end)
  return /^(?:https?:\/\/|mailto:)\S+$/i.test(url) ? url : undefined
}

/** A marker opens with text right after it, and `_` only at a word's start. */
function opens(text: string, at: number, marker: string): boolean {
  const after = text[at + marker.length]
  if (after === undefined || SPACE.test(after)) return false
  return !(marker[0] === '_' && at > 0 && WORD.test(text[at - 1]!))
}

/**
 * The nearest same marker after `from` with text right before it, and for
 * `_` no letter after it. Whether a marker can close does not depend on
 * where the search started, so the answer from `from` stands for any later
 * start up to it; remembering it keeps a line of unclosed markers linear.
 */
function closer(text: string): (marker: string, from: number) => number {
  const last = new Map<string, { readonly from: number; readonly at: number }>()
  return (marker, from) => {
    const hit = last.get(marker)
    if (hit !== undefined && from >= hit.from && (hit.at === -1 || from < hit.at)) return hit.at
    let at = text.indexOf(marker, from + 1)
    for (; at !== -1; at = text.indexOf(marker, at + 1)) {
      if (SPACE.test(text[at - 1]!)) continue
      if (marker.length === 1 && text[at + 1] === marker) {
        at++
        continue
      }
      if (marker[0] === '_' && WORD.test(text[at + marker.length] ?? '')) continue
      break
    }
    last.set(marker, { from, at })
    return at
  }
}

function textInline(text: string, style: InlineStyle): Inline {
  return Object.keys(style).length === 0 ? { kind: 'text', text } : { kind: 'text', text, style }
}

function linkInline(url: string, text: string, style: InlineStyle): Inline {
  return Object.keys(style).length === 0 ? { kind: 'link', url, text } : { kind: 'link', url, text, style }
}
