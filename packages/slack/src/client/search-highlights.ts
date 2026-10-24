export interface MatchRange { readonly start: number; readonly end: number }

/** UTF-16 offsets into the decoded text. Unknown private-use glyphs remain literal. */
export function decodeSearchHighlights(marked: string): { text: string; ranges: ReadonlyArray<MatchRange> } {
  let text = ''
  const ranges: MatchRange[] = []
  const stack: number[] = []
  let end = 0
  for (const match of marked.matchAll(/\uE000|\uE001|<\/?(?:em|b|mark)>/gi)) {
    text += marked.slice(end, match.index)
    if (match[0] === '\uE000' || /^<(em|b|mark)>$/i.test(match[0])) stack.push(text.length)
    else {
      const start = stack.pop()
      if (start !== undefined && text.length > start && stack.length === 0) ranges.push({ start, end: text.length })
    }
    end = match.index + match[0].length
  }
  text += marked.slice(end)
  const start = stack[0]
  if (start !== undefined && text.length > start) ranges.push({ start, end: text.length })
  return { text, ranges }
}
