import { describe, expect, it } from 'vitest'
import { addToViewMenu, channelMenuItems, dropViewOrder, moveViewOrder, topicMenuItems, viewMenuChoice, viewName, type ChannelId } from '../src'

describe('view order', () => {
  const order = ['a', 'b', 'c']

  it('moves one place left or right, and not past an end', () => {
    expect(moveViewOrder(order, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveViewOrder(order, 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveViewOrder(order, 'a', -1)).toBe(order)
    expect(moveViewOrder(order, 'c', 1)).toBe(order)
    expect(moveViewOrder(order, 'x', 1)).toBe(order)
  })

  it('drops before another view, or at the end', () => {
    expect(dropViewOrder(order, 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(dropViewOrder(order, 'a', 'c')).toEqual(['b', 'a', 'c'])
    expect(dropViewOrder(order, 'a', undefined)).toEqual(['b', 'c', 'a'])
    expect(dropViewOrder(order, 'b', 'b')).toBe(order)
    expect(dropViewOrder(order, 'x', 'a')).toBe(order)
  })
})

describe('view name', () => {
  it('is trimmed and at most 32 characters', () => {
    expect(viewName('  Bots  ')).toBe('Bots')
    expect(viewName('   ')).toBe('')
    expect(viewName('x'.repeat(40))).toHaveLength(32)
  })
})

const labels = (items: ReadonlyArray<{ readonly type: string; readonly label?: string }>) => items.flatMap((item) => (item.label === undefined ? [] : [item.label]))

describe('Add to view', () => {
  const views = [
    { id: 'v1', name: 'Bots', holds: true },
    { id: 'v2', name: 'Team', holds: false },
  ]

  it('checks the views that hold the conversation; a checked one removes it, then New view…', () => {
    const menu = addToViewMenu(views)
    expect(menu).toEqual({
      type: 'submenu',
      label: 'Add to view',
      items: [
        { type: 'item', id: 'view-remove:v1', label: 'Bots', checked: true },
        { type: 'item', id: 'view-add:v2', label: 'Team', checked: false },
        { type: 'separator' },
        { type: 'item', id: 'view-new', label: 'New view…' },
      ],
    })
    expect(viewMenuChoice('view-remove:v1')).toEqual({ kind: 'remove', view: 'v1' })
    expect(viewMenuChoice('view-add:v2')).toEqual({ kind: 'add', view: 'v2' })
    expect(viewMenuChoice('view-new')).toEqual({ kind: 'new' })
  })

  it('with no views holds New view… alone', () => {
    expect(addToViewMenu([])).toEqual({ type: 'submenu', label: 'Add to view', items: [{ type: 'item', id: 'view-new', label: 'New view…' }] })
  })

  it('is on a Main row and the channel menu, not on a thread', () => {
    const channel = { id: 'C1' as ChannelId, kind: 'public' as const, name: 'eng' }
    const state = { channel, unread: false, pinned: false, resolved: false, notify: 'auto' as const, canDraw: false, views }
    expect(labels(topicMenuItems({ ...state, kind: 'main' }))).toContain('Add to view')
    expect(labels(topicMenuItems({ ...state, kind: 'thread' }))).not.toContain('Add to view')
    expect(labels(channelMenuItems({ channel, hasMain: true, views }))).toContain('Add to view')
  })
})
