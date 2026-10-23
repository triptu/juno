import { describe, expect, it } from 'bun:test'
import { sidebarMoves, type ShownOrder } from '../src/sidebarMoves'
import { defaultTopicListFilter } from '../src/topics'

const order = (recent: string[], more: Partial<ShownOrder> = {}): ShownOrder => ({ ready: true, filter: defaultTopicListFilter, pinned: [], recent, ...more })

describe('how a change of the sidebar order shows (SPEC 5, "Holding the order")', () => {
  it('slides a reorder that came from elsewhere', () => {
    expect(sidebarMoves(order(['a', 'b', 'c']), order(['c', 'a', 'b']), false, false)).toBe('animate')
  })

  it('shows a command write at once and lets an unrelated write slide', () => {
    const before = order(['a', 'b', 'c'])
    const after = order(['b', 'c'])
    expect(sidebarMoves(before, after, true, false)).toBe('instant')
    expect(sidebarMoves(before, after, false, false)).toBe('animate')
  })

  it('shows a new list at once: the first one, one not ready, and another filter', () => {
    expect(sidebarMoves(undefined, order(['a']), false, false)).toBe('instant')
    expect(sidebarMoves(order([], { ready: false }), order(['a']), false, false)).toBe('instant')
    expect(sidebarMoves(order(['a', 'b']), order(['b'], { filter: { ...defaultTopicListFilter, kind: 'dms' } }), false, false)).toBe('instant')
  })

  it('shows rows landing during the first sync at once', () => {
    expect(sidebarMoves(order(['a']), order(['b', 'a']), false, true)).toBe('instant')
  })

  it('shows a row kept for a tab leaving at once: the tab closed', () => {
    expect(sidebarMoves(order(['a', 'b'], { retained: new Set(['a']) }), order(['b']), false, false)).toBe('instant')
    expect(sidebarMoves(order(['a', 'b'], { retained: new Set(['a']) }), order(['b', 'a']), false, false)).toBe('animate')
  })
})
