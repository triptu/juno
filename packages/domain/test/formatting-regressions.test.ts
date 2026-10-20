import { expect, it } from 'vitest'
import { encodeMentions, mentionTokens } from '../src/composer-mentions'
import { moveLinks } from '../src/composer-links'

it('keeps an italic picked mention and its ID', () => {
  const picks = [{ kind: 'person' as const, id: 'U0MAYA', name: 'Maya Chen' }]
  expect(mentionTokens('_@Maya Chen_', picks)).toHaveLength(1)
  expect(encodeMentions('_@Maya Chen_', picks)).toBe('_<@U0MAYA|Maya Chen>_')
})
it('keeps a linked label when formatting is applied and removed', () => {
  const link = { start: 0, end: 4, url: 'https://example.com/plan' }
  expect(moveLinks('plan', '*plan*', [link])).toEqual([{ ...link, start: 1, end: 5 }])
  expect(moveLinks('*plan*', 'plan', [{ ...link, start: 1, end: 5 }])).toEqual([link])
})
