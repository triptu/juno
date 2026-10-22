/**
 * Clipboard HTML -> the composer's text and linked-word ranges.
 *
 * DOMParser creates an inert document. This reader still allow-lists what it
 * keeps: Slack markup styles, links, line structure, quotes, code and lists.
 * Scripts, handlers, images and presentation are never represented in the
 * returned value.
 */

// Keep this package usable from engine packages whose TypeScript projects do
// not include the DOM library. The runtime value is the renderer's DOMParser;
// conversion only needs this small structural part of the inert document.
interface Node {
  readonly nodeType: number
  readonly textContent: string | null
}

interface Element extends Node {
  readonly localName: string
  readonly childNodes: Iterable<Node>
  readonly children: Iterable<Element>
  getAttribute(name: string): string | null
  querySelectorAll(selectors: string): Iterable<Element>
}

interface ParsedDocument {
  readonly body: Element
}

declare const Node: { readonly TEXT_NODE: number }
declare const Element: { new(): Element }
declare const DOMParser: { new(): { parseFromString(input: string, type: 'text/html'): ParsedDocument } }
declare const URL: { new(input: string): { readonly protocol: string } }

export interface ClipboardLink {
  readonly start: number
  readonly end: number
  readonly url: string
}

export interface ClipboardText {
  readonly text: string
  readonly links: ReadonlyArray<ClipboardLink>
}

interface RunStyle {
  readonly bold: boolean
  readonly italic: boolean
  readonly strike: boolean
  readonly code: boolean
}

interface Run {
  text: string
  readonly style: RunStyle
  readonly link: string | undefined
}

interface Line {
  readonly runs: Run[]
  quote: number
}

interface Context {
  readonly style: RunStyle
  readonly link: string | undefined
  readonly quote: number
}

const PLAIN: RunStyle = { bold: false, italic: false, strike: false, code: false }
const EMPTY: Context = { style: PLAIN, link: undefined, quote: 0 }

const BLOCKS = new Set(['address', 'article', 'aside', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'main', 'nav', 'p', 'section', 'summary'])
const DROPPED = new Set(['applet', 'audio', 'canvas', 'embed', 'iframe', 'img', 'meta', 'noscript', 'object', 'script', 'source', 'style', 'svg', 'template', 'video'])

const sameStyle = (left: RunStyle, right: RunStyle) => left.bold === right.bold && left.italic === right.italic && left.strike === right.strike && left.code === right.code

class LineBuilder {
  readonly lines: Line[] = []
  private current: Line = { runs: [], quote: 0 }

  hasText(): boolean {
    return this.current.runs.length > 0
  }

  append(raw: string, context: Context): void {
    let text = raw.replace(/[\t\n\r\f ]+/g, ' ')
    if (text === '') return
    const last = this.current.runs.at(-1)
    if (last === undefined) text = text.replace(/^ /, '')
    else if (last.text.endsWith(' ') && text.startsWith(' ')) text = text.slice(1)
    if (text === '') return
    this.current.quote = Math.max(this.current.quote, context.quote)
    if (last !== undefined && last.link === context.link && sameStyle(last.style, context.style)) last.text += text
    else this.current.runs.push({ text, style: context.style, link: context.link })
  }

  appendVerbatim(raw: string, quote: number): void {
    const lines = raw.replace(/\r\n?/g, '\n').split('\n')
    lines.forEach((line, index) => {
      if (index > 0) this.break(quote, true)
      if (line !== '') {
        this.current.quote = quote
        this.current.runs.push({ text: line, style: PLAIN, link: undefined })
      }
    })
  }

  break(quote = 0, force = false): void {
    const last = this.current.runs.at(-1)
    if (last !== undefined) {
      const trimmed = last.text.replace(/ +$/, '')
      if (trimmed === '') this.current.runs.pop()
      else last.text = trimmed
    }
    if (this.current.runs.length > 0 || force) {
      this.current.quote = Math.max(this.current.quote, quote)
      this.lines.push(this.current)
    }
    this.current = { runs: [], quote: 0 }
  }

  finish(): ReadonlyArray<Line> {
    this.break()
    while (this.lines[0]?.runs.length === 0) this.lines.shift()
    while (this.lines.at(-1)?.runs.length === 0) this.lines.pop()
    return this.lines
  }
}

function safeLink(raw: string | null): string | undefined {
  if (raw === null) return undefined
  const trimmed = raw.trim()
  if (!/^(?:https?:\/\/|mailto:)/i.test(trimmed)) return undefined
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:' ? trimmed : undefined
  } catch {
    return undefined
  }
}

function styleOf(element: Element, parent: RunStyle): RunStyle {
  const tag = element.localName
  const declaration = element.getAttribute('style')?.toLowerCase() ?? ''
  const property = (name: string): string | undefined => {
    const found = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(declaration)?.[1]?.trim()
    return found === '' ? undefined : found
  }
  const weight = property('font-weight')
  const numericWeight = weight === undefined ? undefined : Number.parseInt(weight, 10)
  const explicitBold = weight === 'bold' || weight === 'bolder' || (numericWeight !== undefined && Number.isFinite(numericWeight) && numericWeight >= 600)
  const explicitNormalWeight = weight === 'normal' || weight === 'lighter' || numericWeight === 400
  const fontStyle = property('font-style')
  const decoration = property('text-decoration') ?? property('text-decoration-line')
  const bold = explicitBold || (!explicitNormalWeight && (tag === 'b' || tag === 'strong' || parent.bold))
  const italic = fontStyle === 'italic' || fontStyle === 'oblique' || (fontStyle !== 'normal' && (tag === 'i' || tag === 'em' || parent.italic))
  const strike = decoration?.includes('line-through') === true || (decoration !== 'none' && (tag === 's' || tag === 'strike' || tag === 'del' || parent.strike))
  return { bold, italic, strike, code: tag === 'code' || parent.code }
}

function childContext(element: Element, context: Context): Context {
  return {
    style: styleOf(element, context.style),
    link: element.localName === 'a' ? safeLink(element.getAttribute('href')) : context.link,
    quote: context.quote,
  }
}

function walkChildren(element: Element, context: Context, builder: LineBuilder): void {
  for (const child of element.childNodes) walk(child, context, builder)
}

function walkList(element: Element, context: Context, builder: LineBuilder): void {
  if (builder.hasText()) builder.break(context.quote)
  const ordered = element.localName === 'ol'
  const parsedStart = Number.parseInt(element.getAttribute('start') ?? '1', 10)
  const start = Number.isFinite(parsedStart) ? parsedStart : 1
  let index = 0
  for (const child of element.children) {
    if (child.localName !== 'li') continue
    if (builder.hasText()) builder.break(context.quote)
    builder.append(ordered ? `${start + index}. ` : '- ', { ...context, style: PLAIN, link: undefined })
    for (const item of child.childNodes) walk(item, context, builder)
    builder.break(context.quote)
    index++
  }
}

function cellText(element: Element): string {
  return (element.textContent ?? '').replace(/[\t\n\r\f ]+/g, ' ').trim()
}

function walkTable(element: Element, context: Context, builder: LineBuilder): void {
  if (builder.hasText()) builder.break(context.quote)
  for (const row of element.querySelectorAll('tr')) {
    const cells = [...row.children].filter((child) => child.localName === 'td' || child.localName === 'th')
    if (cells.length === 0) continue
    builder.appendVerbatim(cells.map(cellText).join('\t'), context.quote)
    builder.break(context.quote)
  }
}

function walkPre(element: Element, context: Context, builder: LineBuilder): void {
  if (builder.hasText()) builder.break(context.quote)
  const raw = (element.textContent ?? '').replace(/\r\n?/g, '\n').replace(/^\n|\n$/g, '')
  if (raw === '') return
  builder.append('```', { ...context, style: PLAIN, link: undefined })
  builder.break(context.quote)
  builder.appendVerbatim(raw, context.quote)
  builder.break(context.quote)
  builder.append('```', { ...context, style: PLAIN, link: undefined })
  builder.break(context.quote)
}

function walk(node: Node, context: Context, builder: LineBuilder): void {
  if (node.nodeType === Node.TEXT_NODE) {
    builder.append(node.textContent ?? '', context)
    return
  }
  if (!(node instanceof Element)) return
  const tag = node.localName
  if (DROPPED.has(tag) || node.getAttribute('hidden') !== null) return
  const declaration = node.getAttribute('style')?.toLowerCase() ?? ''
  if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:;|$)/.test(declaration)) return
  if (tag === 'br') {
    builder.break(context.quote, true)
    return
  }
  if (tag === 'pre') {
    walkPre(node, context, builder)
    return
  }
  if (tag === 'table') {
    walkTable(node, context, builder)
    return
  }
  if (tag === 'ol' || tag === 'ul') {
    walkList(node, context, builder)
    return
  }
  if (tag === 'li') {
    walkChildren(node, context, builder)
    return
  }
  if (tag === 'blockquote') {
    if (builder.hasText()) builder.break(context.quote)
    const quoted = { ...context, quote: context.quote + 1 }
    walkChildren(node, quoted, builder)
    builder.break(quoted.quote)
    return
  }
  const child = childContext(node, context)
  if (BLOCKS.has(tag) && builder.hasText()) builder.break(context.quote)
  walkChildren(node, child, builder)
  if (BLOCKS.has(tag)) builder.break(context.quote)
}

const markers = (style: RunStyle): string => `${style.bold ? '*' : ''}${style.italic ? '_' : ''}${style.strike ? '~' : ''}${style.code ? '`' : ''}`

function serialize(lines: ReadonlyArray<Line>): ClipboardText {
  let text = ''
  const links: ClipboardLink[] = []
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) text += '\n'
    if (line.quote > 0) text += `${'> '.repeat(line.quote)}`
    for (const run of line.runs) {
      if (run.text.trim() === '') {
        text += run.text
        continue
      }
      const leading = /^ */.exec(run.text)?.[0] ?? ''
      const trailing = / *$/.exec(run.text)?.[0] ?? ''
      const core = run.text.slice(leading.length, run.text.length - trailing.length)
      text += leading
      if (core !== '') {
        const mark = markers(run.style)
        const usableMark = [...mark].every((character) => !core.includes(character)) ? mark : ''
        text += usableMark
        const start = text.length
        text += core
        const end = text.length
        if (run.link !== undefined && core !== run.link) links.push({ start, end, url: run.link })
        text += [...usableMark].toReversed().join('')
      }
      text += trailing
    }
  })
  return { text, links }
}

/** Converts inert clipboard HTML into the text and linked words the composer owns. */
export function clipboardHtml(html: string): ClipboardText {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const builder = new LineBuilder()
  for (const child of document.body.childNodes) walk(child, EMPTY, builder)
  return serialize(builder.finish())
}
