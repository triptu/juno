import { describe, expect, it } from 'bun:test'
import { shouldMarkRead, type ReadView } from '../src/reads'

const watching: ReadView = { active: true, focused: true, atBottom: true, markedUnread: false }

describe('the read rule', () => {
  it('opening a topic marks it read', () => {
    expect(shouldMarkRead('open', { ...watching, atBottom: false, focused: false })).toBe(true)
  })

  it('later messages are marked only at the bottom of the active tab in a focused window', () => {
    expect(shouldMarkRead('bottom', watching)).toBe(true)
    expect(shouldMarkRead('bottom', { ...watching, atBottom: false })).toBe(false)
    expect(shouldMarkRead('bottom', { ...watching, focused: false })).toBe(false)
    expect(shouldMarkRead('bottom', { ...watching, active: false })).toBe(false)
  })

  it('a topic marked unread stays unread at the bottom until it is opened again', () => {
    const held = { ...watching, markedUnread: true }
    expect(shouldMarkRead('bottom', held)).toBe(false)
    expect(shouldMarkRead('open', held)).toBe(true)
  })
})
