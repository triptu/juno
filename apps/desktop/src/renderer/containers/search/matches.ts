/**
 * The reader's matches (SPEC 10a, "The reader is the topic itself"): which
 * messages of the topic, as Juno holds it, match the search, oldest first,
 * for "2 of 5" and ⌘↑ ⌘↓; and the matched words marked with CSS highlights,
 * which change no layout, so marking never moves a message.
 */
import { searchRanges } from '@juno/contract'

const MATCH = 'search-match'
const CURRENT = 'search-current'

/** Ranges over each matched word in the message's text nodes. A phrase split across elements is left unmarked. */
function rangesIn(element: Element, words: ReadonlyArray<string>): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    for (const { start, end } of searchRanges(node.textContent ?? '', words)) {
      const range = new Range()
      range.setStart(node, start)
      range.setEnd(node, end)
      ranges.push(range)
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
