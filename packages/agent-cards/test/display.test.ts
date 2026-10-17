// How a card shows a value (SPEC 13.3): strings bare, short string lists on one line, the rest as indented lines.
import { expect, it } from 'vitest'
import { readableValue } from '../src/display'

it.each([
  ['Lunch', 'Lunch'],
  [3, '3'],
  [true, 'true'],
  [null, 'none'],
  [['design', 'eng'], 'design, eng'],
  [[], 'none'],
  [['A long first item that goes on', 'and a second one that does as well'], '• A long first item that goes on\n• and a second one that does as well'],
  [{ title: 'Lunch', tags: ['food'] }, 'title: Lunch\ntags: food'],
  [{ page: { id: 'p1', title: 'Offsite' } }, 'page:\n  id: p1\n  title: Offsite'],
  [[{ id: 1 }, { id: 2 }], '• id: 1\n• id: 2'],
])('shows %j as %j', (value, shown) => {
  expect(readableValue(value)).toBe(shown)
})
