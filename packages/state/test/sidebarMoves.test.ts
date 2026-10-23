import { expect, it } from 'bun:test'
import { sidebarMoves, type ShownOrder } from '../src/sidebarMoves'
import { defaultTopicListFilter } from '../src/topics'

const order = (recent: string[], more: Partial<ShownOrder> = {}): ShownOrder => ({ ready: true, filter: defaultTopicListFilter, pinned: [], recent, ...more })

// How a change of the sidebar order shows (SPEC 5, "Holding the order"). sidebar-motion.spec drives the
// outside reply, the own Resolve and a burst in the app; these are the cases it does not reach.
it.each<[string, ShownOrder | undefined, ShownOrder, boolean, boolean, 'animate' | 'instant']>([
  ['a reorder from elsewhere slides', order(['a', 'b', 'c']), order(['c', 'a', 'b']), false, false, 'animate'],
  ['a command write shows at once', order(['a', 'b', 'c']), order(['b', 'c']), true, false, 'instant'],
  ['an unrelated write slides', order(['a', 'b', 'c']), order(['b', 'c']), false, false, 'animate'],
  ['the first list shows at once', undefined, order(['a']), false, false, 'instant'],
  ['a list that was not ready shows at once', order([], { ready: false }), order(['a']), false, false, 'instant'],
  ['another filter shows at once', order(['a', 'b']), order(['b'], { filter: { ...defaultTopicListFilter, kind: 'dms' } }), false, false, 'instant'],
  ['rows landing during the first sync show at once', order(['a']), order(['b', 'a']), false, true, 'instant'],
  ['a row kept for a tab goes at once when the tab closes', order(['a', 'b'], { retained: new Set(['a']) }), order(['b']), false, false, 'instant'],
  ['a row kept for a tab that moves still slides', order(['a', 'b'], { retained: new Set(['a']) }), order(['b', 'a']), false, false, 'animate'],
])('%s', (_, before, after, command, firstSync, expected) => {
  expect(sidebarMoves(before, after, command, firstSync)).toBe(expected)
})
