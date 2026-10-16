/**
 * The rich text of a Juno bubble (SPEC 13.1): the small markdown subset the
 * chat renders, parsed from the bubble's spans once their sources are
 * resolved. Paragraphs, headings (a bold line), bullet and numbered lists
 * and code blocks here; bold, italic, inline code and links in
 * `rich-inline.ts`. A rule or a quote mark shows as nothing, a table row as
 * its cells joined by " · ".
 *
 * Models write HTML now and then. It never shows: `rich-html.ts` maps the
 * common tags to the same structure and drops any other tag to its text.
 * Text inside backticks or a code block is left as written.
 */
import type { JunoBlock, JunoInline } from '@juno/agent-contract'
import { closingFence, FENCE, normalize } from './rich-html'
import { inlinesOf, placeholder, RESERVED, restore, type Sources } from './rich-inline'
import type { BubbleSpan } from './sources'

/** The blocks of a bubble whose spans are `spans`. */
export function blocksOf(spans: ReadonlyArray<BubbleSpan>): ReadonlyArray<JunoBlock> {
  const sources: Array<Sources[number]> = []
  let doc = ''
  for (const span of spans) {
    if ('source' in span) {
      doc += placeholder(sources.length)
      sources.push(span)
    } else {
      doc += span.text.replace(RESERVED, '')
    }
  }
  const lines = normalize(doc).split('\n')
  const builder = new Builder(sources)
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE.exec(lines[i]!)
    if (fence === null) {
      builder.line(lines[i]!)
      continue
    }
    const close = closingFence(lines, i, fence[1]!)
    const end = close === -1 ? lines.length : close
    builder.code(lines.slice(i + 1, end).join('\n'))
    i = end
  }
  return builder.done()
}

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const BULLET = /^(\s*)[-*+•]\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const TABLE_ROW = /^\s*\|(.*)\|\s*$/
/** The line under a markdown table's header: pipes, dashes and colons. */
const isTableRule = (line: string) => /^[\s|:-]+$/.test(line) && line.includes('|') && line.includes('---')

class Builder {
  private readonly blocks: JunoBlock[] = []
  private paragraph: string[] = []
  private list: { ordered: boolean; start?: number; items: string[] } | undefined
  private blank = false

  constructor(private readonly sources: Sources) {}

  private inlines(text: string): ReadonlyArray<JunoInline> {
    return inlinesOf(text.trim(), this.sources)
  }

  private endParagraph() {
    const text = this.paragraph.join('\n').trim()
    if (text !== '') this.blocks.push({ _tag: 'paragraph', inlines: this.inlines(text) })
    this.paragraph = []
  }

  private endList() {
    const list = this.list
    this.list = undefined
    if (list === undefined) return
    const items = list.items.map((item) => this.inlines(item)).filter((item) => item.length > 0)
    if (items.length > 0) this.blocks.push({ _tag: 'list', ordered: list.ordered, ...(list.start === undefined ? {} : { start: list.start }), items })
  }

  private end() {
    this.endParagraph()
    this.endList()
  }

  code(text: string) {
    this.end()
    this.blank = false
    if (text.trim() !== '') this.blocks.push({ _tag: 'codeBlock', text: restore(text, this.sources) })
  }

  line(line: string) {
    if (line.trim() === '') {
      this.endParagraph()
      this.blank = true
      return
    }
    const afterBlank = this.blank
    this.blank = false
    // A table's header rule goes; its rows stay one paragraph.
    if (isTableRule(line)) return
    if (RULE.test(line)) return this.end()
    const heading = HEADING.exec(line)
    if (heading !== null) {
      this.end()
      const inlines = this.inlines(heading[1]!)
      if (inlines.length > 0) this.blocks.push({ _tag: 'heading', inlines })
      return
    }
    if (this.item(line)) return
    // An indented line straight under an item continues it.
    if (this.list !== undefined && !afterBlank && /^\s+/.test(line)) {
      this.list.items[this.list.items.length - 1] += `\n${line.trim()}`
      return
    }
    this.endList()
    const quote = QUOTE.exec(line)
    const row = quote === null ? TABLE_ROW.exec(line) : null
    const text = quote !== null ? quote[1]! : row !== null ? row[1]!.split('|').map((cell) => cell.trim()).join(' · ') : line
    this.paragraph.push(text.trim())
  }

  /** A list item, added to the list it continues or starting one. False for any other line. */
  private item(line: string): boolean {
    const bullet = BULLET.exec(line)
    const ordered = bullet === null ? ORDERED.exec(line) : null
    if (bullet === null && ordered === null) return false
    const indent = (bullet ?? ordered)![1]!.length
    const text = bullet !== null ? bullet[2]! : ordered![3]!
    const isOrdered = ordered !== null
    // A nested item joins the list it is under: the chat shows one level.
    if (this.list !== undefined && (this.list.ordered === isOrdered || indent > 0)) {
      this.endParagraph()
      this.list.items.push(text)
      return true
    }
    this.end()
    const start = isOrdered ? Number(ordered![2]) : 1
    this.list = { ordered: isOrdered, ...(start === 1 ? {} : { start }), items: [text] }
    return true
  }

  done(): ReadonlyArray<JunoBlock> {
    this.end()
    return this.blocks
  }
}
