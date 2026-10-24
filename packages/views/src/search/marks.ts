/**
 * The search mark (SPEC 10a): the matched words in message text as CSS
 * highlights, which change no layout, so marking never moves a line. The
 * styles are in `global.css` (`--find`, `--find-current`). The cards mark
 * into `search-card`, the reader into `search-match` and `search-current`,
 * so neither clears the other's.
 */
import { useEffect, type RefObject } from 'react'
import { searchRanges } from '@juno/contract'

/** Ranges over each matched word in an element's text nodes. A phrase split across elements is left unmarked. */
export function matchRanges(element: Element, words: ReadonlyArray<string>): Range[] {
  const ranges: Range[] = []
  if (words.length === 0) return ranges
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

const CARDS = 'search-card'

/** Marks the words in every card's message under `root`, and again as cards draw. */
export function useCardMarks(root: RefObject<HTMLElement | null>, words: ReadonlyArray<string>): void {
  const key = words.join('\n')
  useEffect(() => {
    const element = root.current
    const registry = typeof CSS === 'undefined' ? undefined : CSS.highlights
    if (element === null || registry === undefined) return
    const list = key === '' ? [] : key.split('\n')
    let frame: number | undefined
    const run = () => {
      frame = undefined
      const highlight = new Highlight()
      for (const text of element.querySelectorAll('[data-search-card] [data-msg-text]')) for (const range of matchRanges(text, list)) highlight.add(range)
      registry.set(CARDS, highlight)
    }
    const soon = () => {
      if (frame === undefined) frame = requestAnimationFrame(run)
    }
    run()
    const observer = new MutationObserver(soon)
    observer.observe(element, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      registry.delete(CARDS)
    }
  }, [root, key])
}
