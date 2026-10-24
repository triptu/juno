/** Accent-insensitive matches mapped back to the source's UTF-16 boundaries. */
export function searchRanges(text: string, words: ReadonlyArray<string>): Array<{ start: number; end: number }> {
  const normalized = text.normalize('NFD')
  let folded = fold(normalized)
  const direct = normalized === text && folded.length === text.length
  const starts: number[] = []
  const ends: number[] = []
  if (!direct) {
    folded = ''
    let offset = 0
    for (const point of text) {
      const value = fold(point)
      const end = offset + point.length
      if (value === '' && /\p{M}/u.test(point)) {
        for (let i = ends.length - 1; i >= 0 && ends[i] === offset; i--) ends[i] = end
      }
      for (let i = 0; i < value.length; i++) { starts.push(offset); ends.push(end) }
      folded += value
      offset = end
    }
  }
  const found: Array<{ start: number; end: number }> = []
  for (const word of words) {
    const needle = fold(word)
    if (needle === '') continue
    for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) {
      const start = direct ? at : starts[at]
      const end = direct ? at + needle.length : ends[at + needle.length - 1]
      if (start !== undefined && end !== undefined) found.push({ start, end })
    }
  }
  const merged: Array<{ start: number; end: number }> = []
  for (const range of found.toSorted((a, b) => a.start - b.start)) {
    const previous = merged.at(-1)
    if (previous !== undefined && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push(range)
  }
  return merged
}
const fold = (text: string) => text.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '')
