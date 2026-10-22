/**
 * Where an arrow key moves focus from `from`: the next or previous emoji,
 * or the same column one row up or down, across section edges. `null` means
 * the search field; `undefined` means the key is not an arrow.
 * Uses the complete section order, including rows outside the viewport.
 */
export function neighbour(sections: ReadonlyArray<{ readonly items: ReadonlyArray<unknown> }>, from: number, key: string, columns: number): number | null | undefined {
  const groups = sections.filter((section) => section.items.length > 0)
  let start = 0
  const s = groups.findIndex((section) => {
    if (from < start + section.items.length) return true
    start += section.items.length
    return false
  })
  const cells = groups[s]?.items
  if (cells === undefined) return undefined
  const i = from - start
  const column = i % columns
  const previous = groups[s - 1]?.items
  const next = groups[s + 1]?.items
  switch (key) {
    case 'ArrowLeft': return Math.max(0, from - 1)
    case 'ArrowRight': return Math.min(groups.reduce((count, group) => count + group.items.length, 0) - 1, from + 1)
    case 'ArrowUp': {
      if (i >= columns) return from - columns
      if (previous === undefined) return null
      const lastRow = Math.floor((previous.length - 1) / columns) * columns
      return start - previous.length + Math.min(lastRow + column, previous.length - 1)
    }
    case 'ArrowDown': {
      if (i + columns < cells.length) return from + columns
      if (Math.floor(i / columns) < Math.floor((cells.length - 1) / columns)) return start + cells.length - 1
      return next === undefined ? from : start + cells.length + Math.min(column, next.length - 1)
    }
    default: return undefined
  }
}

