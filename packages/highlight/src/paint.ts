/**
 * Puts a block's colours on the page with the CSS Custom Highlight API: one
 * named highlight per token kind (`syntax-keyword`, ...), which
 * `@juno/tokens/global.css` colours with the `--syntax-*` tokens. The text
 * stays one text node, so colouring changes no element, no layout and no
 * React state, and selection and copy work as on plain text.
 */
import type { HighlightedCode, SyntaxKind } from './index'

const highlights = new Map<SyntaxKind, Highlight>()

function highlightOf(kind: SyntaxKind): Highlight {
  let highlight = highlights.get(kind)
  if (highlight === undefined) {
    highlight = new Highlight()
    CSS.highlights.set(`syntax-${kind}`, highlight)
    highlights.set(kind, highlight)
  }
  return highlight
}

const nothing = () => {}

/**
 * Colours the text under `element` with `code`'s tokens and marks the
 * element with `data-code-language`. Returns a function that takes the
 * colours off. Paints nothing when the text under `element` is not the
 * tokens' text (it changed since they were worked out).
 */
export function paintCode(element: HTMLElement, code: HighlightedCode): () => void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return nothing
  const nodes: Text[] = []
  const starts: number[] = []
  let length = 0
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text)
    starts.push(length)
    length += (node as Text).data.length
  }
  // The element must still show the text the tokens were worked out for.
  if (nodes.map((node) => node.data).join('') !== code.tokens.map((token) => token.text).join('')) return nothing

  // The text node holding character `at`, from the one before it.
  let index = 0
  const point = (at: number, from: number): readonly [Text, number, number] => {
    let i = from
    while (i < nodes.length - 1 && starts[i + 1]! <= at) i++
    return [nodes[i]!, at - starts[i]!, i]
  }
  const painted: Array<readonly [Highlight, Range]> = []
  let offset = 0
  for (const token of code.tokens) {
    const start = offset
    offset += token.text.length
    if (token.kind === undefined) continue
    const [startNode, startOffset, startIndex] = point(start, index)
    const [endNode, endOffset] = point(offset, startIndex)
    index = startIndex
    const range = new Range()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    const highlight = highlightOf(token.kind)
    highlight.add(range)
    painted.push([highlight, range])
  }
  element.dataset['codeLanguage'] = code.language
  return () => {
    for (const [highlight, range] of painted) highlight.delete(range)
    delete element.dataset['codeLanguage']
  }
}
