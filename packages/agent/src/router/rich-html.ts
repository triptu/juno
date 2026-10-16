/**
 * The HTML that models write in a bubble, read as the markdown the chat
 * renders (`rich.ts`). Block tags become markdown lines here; inline tags
 * are read by `rich-inline.ts` with `matchTag`. Nothing inside a fenced
 * block or backticks is touched.
 */

// Element names stripped with no attributes. Any name with an attribute
// (`<span class="x">`) is a tag too. Other words in angle brackets
// ("Array<string>", "a <b and c>") stay as text.
const ELEMENTS = new Set(
  ('a abbr article aside b big blockquote body br caption center cite code col dd del details div dl dt em figcaption figure font footer ' +
    'h1 h2 h3 h4 h5 h6 head header hr html i img ins kbd label li mark ol p pre q s section small span strike strong sub summary sup ' +
    'table tbody td tfoot th thead tr tt u ul var').split(' '),
)
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*\/?>/y

export interface Tag {
  readonly name: string
  readonly closing: boolean
  readonly length: number
}

/** The HTML tag that starts at `i` in `s`, if one does. */
export function matchTag(s: string, i: number): Tag | undefined {
  TAG.lastIndex = i
  const m = TAG.exec(s)
  if (m === null) return undefined
  const attributes = m[3]!
  const known = attributes.includes('=') || (attributes.trim() === '' && ELEMENTS.has(m[2]!.toLowerCase()))
  return known ? { name: m[2]!.toLowerCase(), closing: m[1] === '/', length: m[0].length } : undefined
}

export function stripTags(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const tag = text[i] === '<' ? matchTag(text, i) : undefined
    if (tag === undefined) out += text[i]
    else i += tag.length - 1
  }
  return out
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, name: string) => {
    if (!name.startsWith('#')) return ENTITIES[name.toLowerCase()] ?? match
    const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

export const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/** The line that closes the fence opened on line `open`, or -1: an open fence runs to the end. */
export function closingFence(lines: ReadonlyArray<string>, open: number, marker: string): number {
  for (let j = open + 1; j < lines.length; j++) {
    const m = FENCE.exec(lines[j]!)
    if (m !== null && m[1]![0] === marker[0] && m[1]!.length >= marker.length && lines[j]!.trim() === m[1]) return j
  }
  return -1
}

/** Block-level HTML as markdown lines, outside fenced code. */
export function normalize(doc: string): string {
  const lines = doc.split('\n')
  const out: string[] = []
  let chunk: string[] = []
  const flush = () => {
    if (chunk.length > 0) out.push(htmlBlocks(chunk.join('\n')))
    chunk = []
  }
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE.exec(lines[i]!)
    if (fence === null) {
      chunk.push(lines[i]!)
      continue
    }
    flush()
    const close = closingFence(lines, i, fence[1]!)
    const last = close === -1 ? lines.length - 1 : close
    out.push(...lines.slice(i, last + 1))
    i = last
  }
  flush()
  return out.join('\n')
}

const BLOCK_HTML = /`[^`\n]*`|<pre\b[^>]*>([\s\S]*?)<\/pre\s*>|<(\/?)(br|p|div|ul|ol|li|h[1-6]|hr|blockquote|table|tr|td|th)\b[^<>]*>/gi

/** `<li>` becomes "- " or "1. " by its list, and `<pre>` a fenced block. */
function htmlBlocks(text: string): string {
  const lists: Array<{ ordered: boolean; count: number }> = []
  const block = (name: string, end: boolean): string => {
    switch (name) {
      case 'br':
      case 'tr':
        return '\n'
      case 'td':
      case 'th':
        return end ? '' : ' '
      case 'ul':
      case 'ol':
        if (end) lists.pop()
        else lists.push({ ordered: name === 'ol', count: 0 })
        return '\n\n'
      case 'li': {
        const list = lists.at(-1)
        if (end) return '\n'
        if (list?.ordered !== true) return '\n- '
        list.count += 1
        return `\n${list.count}. `
      }
      default:
        return /^h[1-6]$/.test(name) && !end ? '\n\n### ' : '\n\n'
    }
  }
  return text
    .replace(/<li\b[^>]*>\s*<p\b[^>]*>/gi, '<li>')
    .replace(/<\/p>\s*<\/li>/gi, '</li>')
    .replace(BLOCK_HTML, (match, pre: string | undefined, closing: string | undefined, name: string | undefined) => {
      if (match.startsWith('`')) return match
      if (pre !== undefined) return `\n\`\`\`\n${decode(stripTags(pre)).replace(/^\n|\n$/g, '')}\n\`\`\`\n`
      return block(name!.toLowerCase(), closing === '/')
    })
}
