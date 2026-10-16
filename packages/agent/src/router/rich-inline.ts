/**
 * The inline marks of a Juno bubble (`rich.ts`): bold, italic and inline
 * code, in markdown or in the HTML tags models write, and source links.
 * Markdown links and strikethrough show as their words; any other tag
 * drops. Text that opens nothing ("2 * 3", "snake_case") stays as written.
 */
import type { JunoInline } from '@juno/agent-contract'
import { decode, matchTag, stripTags } from './rich-html'
import type { SourceRef } from './sources'

export interface Marks {
  readonly bold?: true
  readonly italic?: true
}

export type Sources = ReadonlyArray<{ readonly text: string; readonly source: SourceRef }>

// Private-use characters around a source's index stand for the source while
// the text is parsed, so a source inside bold or a list item keeps its link.
const OPEN = String.fromCharCode(0xe000)
const CLOSE = String.fromCharCode(0xe001)
export const placeholder = (n: number) => `${OPEN}${n}${CLOSE}`
export const RESERVED = new RegExp(`[${OPEN}${CLOSE}]`, 'g')
const PLACEHOLDERS = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g')
const PLACEHOLDER_AT = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'y')

/** The source placeholders in `text` as the sources' words, for code. */
export const restore = (text: string, sources: Sources) => text.replace(PLACEHOLDERS, (_, n: string) => sources[Number(n)]?.text ?? '')

/** The inlines of `text`, adjacent runs with the same marks joined. */
export function inlinesOf(text: string, sources: Sources): ReadonlyArray<JunoInline> {
  return merge(parse(text, {}, sources))
}

/** What a step read at an index: inlines, literal text, or nothing to show, and where to go on. */
type Step = { readonly inlines: ReadonlyArray<JunoInline>; readonly next: number } | { readonly text: string; readonly next: number }
type Reader = (s: string, i: number, marks: Marks, sources: Sources) => Step | undefined

function parse(s: string, marks: Marks, sources: Sources): JunoInline[] {
  const out: JunoInline[] = []
  let buf = ''
  const flush = () => {
    if (buf !== '') out.push({ _tag: 'text', text: decode(buf), ...marks })
    buf = ''
  }
  for (let i = 0; i < s.length; ) {
    const step = READERS[s[i]!]?.(s, i, marks, sources)
    if (step === undefined) {
      buf += s[i]
      i += 1
    } else if ('text' in step) {
      buf += step.text
      i = step.next
    } else {
      flush()
      out.push(...step.inlines)
      i = step.next
    }
  }
  flush()
  return out
}

const PUNCTUATION = /[!-/:-@[-`{-~]/

const escape: Reader = (s, i) => (i + 1 < s.length && PUNCTUATION.test(s[i + 1]!) ? { text: s[i + 1]!, next: i + 2 } : undefined)

const source: Reader = (s, i, marks, sources) => {
  PLACEHOLDER_AT.lastIndex = i
  const found = PLACEHOLDER_AT.exec(s)
  const span = found === null ? undefined : sources[Number(found[1])]
  if (found === null || span === undefined) return { text: '', next: i + 1 }
  const { channelId, ts, place } = span.source
  const inlines = parse(span.text, marks, sources).map((inline): JunoInline => {
    const own = inline._tag === 'text' ? { ...(inline.bold ? { bold: true as const } : {}), ...(inline.italic ? { italic: true as const } : {}) } : marks
    return { _tag: 'source', text: inline.text, channelId, ts, place: place ?? channelId, ...own }
  })
  return { inlines, next: found.index + found[0].length }
}

const code: Reader = (s, i, _, sources) => {
  const run = /^`+/.exec(s.slice(i))![0]
  const close = s.indexOf(run, i + run.length)
  if (close === -1 || s[close + run.length] === '`') return { text: run, next: i + run.length }
  const text = restore(s.slice(i + run.length, close).replace(/^ (.+) $/, '$1'), sources)
  return { inlines: text === '' ? [] : [{ _tag: 'code', text }], next: close + run.length }
}

const MARK_TAGS: Record<string, keyof Marks> = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic' }

const html: Reader = (s, i, marks, sources) => {
  const codeTag = /<code\b[^>]*>([\s\S]*?)<\/code\s*>/iy
  codeTag.lastIndex = i
  const c = codeTag.exec(s)
  if (c !== null) {
    const text = restore(decode(stripTags(c[1]!)), sources)
    return { inlines: text === '' ? [] : [{ _tag: 'code', text }], next: i + c[0].length }
  }
  const tag = matchTag(s, i)
  if (tag === undefined) return undefined
  const mark = MARK_TAGS[tag.name]
  if (mark !== undefined && !tag.closing) {
    const closer = new RegExp(`</${tag.name}\\s*>`, 'ig')
    closer.lastIndex = i + tag.length
    const end = closer.exec(s)
    if (end !== null) return { inlines: parse(s.slice(i + tag.length, end.index), { ...marks, [mark]: true }, sources), next: end.index + end[0].length }
  }
  // Any other tag, or one left open: its words only.
  return { inlines: [], next: i + tag.length }
}

const emphasis: Reader = (s, i, marks, sources) => {
  const ch = s[i]!
  let run = 1
  while (s[i + run] === ch) run++
  const width = Math.min(run, 3)
  const next = s[i + run]
  const opens = next !== undefined && !/\s/.test(next) && (ch === '*' || !isWord(s[i - 1]))
  const close = opens ? findCloser(s, i + width, ch.repeat(width)) : -1
  if (close === -1) return { text: ch.repeat(run), next: i + run }
  const added: Marks = width === 1 ? { italic: true } : width === 2 ? { bold: true } : { bold: true, italic: true }
  return { inlines: parse(s.slice(i + width, close), { ...marks, ...added }, sources), next: close + width }
}

const strike: Reader = (s, i, marks, sources) => {
  if (s[i + 1] !== '~') return undefined
  const close = s.indexOf('~~', i + 2)
  return close > i + 2 ? { inlines: parse(s.slice(i + 2, close), marks, sources), next: close + 2 } : undefined
}

const link: Reader = (s, i, marks, sources) => {
  const pattern = /\[([^\]\n]+)\]\(([^()\s]+)\)/y
  pattern.lastIndex = i
  const l = pattern.exec(s)
  return l === null ? undefined : { inlines: parse(l[1]!, marks, sources), next: i + l[0].length }
}

const READERS: Record<string, Reader> = { '\\': escape, [OPEN]: source, '`': code, '<': html, '*': emphasis, _: emphasis, '~': strike, '[': link }

const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch)

/**
 * Where the delimiter `delim` that closes one opened before `from` starts,
 * or -1. A closer follows a non-space; an underscore closer is not inside a
 * word; a single star or underscore is not part of a longer run.
 */
function findCloser(s: string, from: number, delim: string): number {
  const ch = delim[0]!
  for (let j = s.indexOf(delim, from); j !== -1; j = s.indexOf(delim, j + 1)) {
    if (j === from) continue
    const before = s[j - 1]!
    const after = s[j + delim.length]
    if (/\s/.test(before) || (ch === '_' && isWord(after))) continue
    if (delim.length === 1 && (before === ch || after === ch)) {
      // Skip the whole run so its stars are not read one at a time.
      while (s[j + 1] === ch) j++
      continue
    }
    if (delim.length > 1 && after === ch) continue
    return j
  }
  return -1
}

const sameMarks = (a: JunoInline, b: JunoInline) => a._tag === 'text' && b._tag === 'text' && a.bold === b.bold && a.italic === b.italic

function merge(inlines: ReadonlyArray<JunoInline>): ReadonlyArray<JunoInline> {
  const out: JunoInline[] = []
  for (const inline of inlines) {
    const last = out.at(-1)
    if (last !== undefined && sameMarks(last, inline)) out[out.length - 1] = { ...last, text: last.text + inline.text }
    else out.push(inline)
  }
  return out
}
