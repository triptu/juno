import { describe, expect, it } from 'vitest'
import { OWN_CHANGE_MS, sidebarMoves, type ShownOrder } from '../src/sidebarMoves'
import { defaultTopicListFilter } from '../src/topics'

const order = (recent: string[], more: Partial<ShownOrder> = {}): ShownOrder => ({ ready: true, filter: defaultTopicListFilter, pinned: [], recent, ...more })
const NOW = 100_000
const LONG_AGO = Number.NEGATIVE_INFINITY

describe('how a change of the sidebar order shows (SPEC 5, "Holding the order")', () => {
  it('slides a reorder that came from elsewhere', () => {
    expect(sidebarMoves(order(['a', 'b', 'c']), order(['c', 'a', 'b']), LONG_AGO, NOW, false)).toBe('animate')
  })

  it('shows a change soon after your own action at once, and slides again once that has passed', () => {
    const before = order(['a', 'b', 'c'])
    const after = order(['b', 'c'])
    expect(sidebarMoves(before, after, NOW - 200, NOW, false)).toBe('instant')
    expect(sidebarMoves(before, after, NOW - OWN_CHANGE_MS, NOW, false)).toBe('animate')
  })

  it('shows a new list at once: the first one, one not ready, and another filter', () => {
    expect(sidebarMoves(undefined, order(['a']), LONG_AGO, NOW, false)).toBe('instant')
    expect(sidebarMoves(order([], { ready: false }), order(['a']), LONG_AGO, NOW, false)).toBe('instant')
    expect(sidebarMoves(order(['a', 'b']), order(['b'], { filter: { ...defaultTopicListFilter, kind: 'dms' } }), LONG_AGO, NOW, false)).toBe('instant')
  })

  it('shows rows landing during the first sync at once', () => {
    expect(sidebarMoves(order(['a']), order(['b', 'a']), LONG_AGO, NOW, true)).toBe('instant')
  })

  it('shows a row kept for a tab leaving at once: the tab closed', () => {
    expect(sidebarMoves(order(['a', 'b'], { retained: new Set(['a']) }), order(['b']), LONG_AGO, NOW, false)).toBe('instant')
    expect(sidebarMoves(order(['a', 'b'], { retained: new Set(['a']) }), order(['b', 'a']), LONG_AGO, NOW, false)).toBe('animate')
  })
})
