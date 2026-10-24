/**
 * The reader's matches (SPEC 10a, "The reader is the topic itself"): which
 * messages of the topic, as Juno holds it, match the search, oldest first,
 * for "2 of 5" and ⌘↑ ⌘↓; and the matched words marked with CSS highlights,
 * which change no layout, so marking never moves a message.
 */
import type { MessageView, SearchQuery } from '@juno/contract'
import type { MessageWindow } from '@juno/state'

export interface ReaderTerms {
  /** Words and phrases every match holds, lower case. */
  readonly include: ReadonlyArray<string>
  /** Words no match holds. */
  readonly exclude: ReadonlyArray<string>
  /** from: chips' people; any of them. Empty for anyone. */
  readonly from: ReadonlySet<string>
}

export function readerTerms(query: SearchQuery | undefined, from: ReadonlySet<string>): ReaderTerms {
  const words = (negated: boolean) => (query?.clauses ?? []).flatMap((clause) => ((clause.kind === 'term' || clause.kind === 'phrase') && clause.negated === negated && clause.value !== '' ? [clause.value.toLowerCase()] : []))
  return { include: words(false), exclude: words(true), from }
}

/** The text of a message body, for matching: every `text` the body holds, in order. */
function bodyText(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) bodyText(item, out)
  else if (value !== null && typeof value === 'object') {
    for (const [key, field] of Object.entries(value)) {
      if ((key === 'text' || key === 'name') && typeof field === 'string') out.push(field)
      else if (typeof field === 'object') bodyText(field, out)
    }
  }
  return out
}

function matches(row: MessageView, terms: ReaderTerms): boolean {
  if (terms.from.size > 0 && (row.senderId === undefined || !terms.from.has(row.senderId))) return false
  if (terms.include.length === 0) return terms.from.size > 0
  const text = bodyText(row.body).join(' ').toLowerCase()
  return terms.include.every((word) => text.includes(word)) && !terms.exclude.some((word) => text.includes(word))
}

/** The messages that match, oldest first, with the chosen one always among them. */
export function readerMatches(list: MessageWindow, terms: ReaderTerms, chosen: string | undefined): ReadonlyArray<string> {
  const found = list.order.filter((ts) => {
    const row = list.rows.get(ts)
    return ts === chosen || (row !== undefined && matches(row, terms))
  })
  return found
}

const MATCH = 'search-match'
const CURRENT = 'search-current'

/** Ranges over each matched word in the message's text nodes. A phrase split across elements is left unmarked. */
function rangesIn(element: Element, words: ReadonlyArray<string>): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.toLowerCase() ?? ''
    for (const word of words) {
      for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
        const range = new Range()
        range.setStart(node, at)
        range.setEnd(node, at + word.length)
        ranges.push(range)
      }
    }
  }
  return ranges
}

/**
 * Marks the matched words of the `marked` messages under `root`, the
 * current one more strongly. Returns the undo. Two readers never show at
 * once, so the highlight names are the page's.
 */
export function markMatches(root: Element, marked: ReadonlyArray<string>, current: string | undefined, words: ReadonlyArray<string>): () => void {
  const registry = CSS.highlights
  if (registry === undefined || words.length === 0) return () => {}
  const all = new Highlight()
  const strong = new Highlight()
  strong.priority = 1
  for (const ts of marked) {
    const text = root.querySelector(`[data-message-row="${CSS.escape(ts)}"] [data-msg-text]`)
    if (text === null) continue
    for (const range of rangesIn(text, words)) (ts === current ? strong : all).add(range)
  }
  registry.set(MATCH, all)
  registry.set(CURRENT, strong)
  return () => {
    if (registry.get(MATCH) === all) registry.delete(MATCH)
    if (registry.get(CURRENT) === strong) registry.delete(CURRENT)
  }
}
