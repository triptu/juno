import { describe, expect, it } from 'vitest'
import { shouldMarkRead, type ReadView } from '../src/reads'

const watching: ReadView = { stealth: false, active: true, focused: true, atBottom: true }

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

  it('stealth never marks, except its own Mark read', () => {
    const stealth = { ...watching, stealth: true }
    expect(shouldMarkRead('open', stealth)).toBe(false)
    expect(shouldMarkRead('bottom', stealth)).toBe(false)
    expect(shouldMarkRead('mark-read', stealth)).toBe(true)
  })
})
