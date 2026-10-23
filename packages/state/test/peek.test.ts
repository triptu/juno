import { describe, expect, it } from 'bun:test'
import { isPeekKey } from '../src/peek'

describe('the peek key', () => {
  it('⌥ Option peeks, also while typing', () => {
    expect(isPeekKey('option', 'Alt', false)).toBe(true)
    expect(isPeekKey('option', 'Alt', true)).toBe(true)
    expect(isPeekKey('option', ' ', false)).toBe(false)
  })

  it('Space peeks only when no text field has focus', () => {
    expect(isPeekKey('space', ' ', false)).toBe(true)
    expect(isPeekKey('space', ' ', true)).toBe(false)
    expect(isPeekKey('space', 'Alt', false)).toBe(false)
  })
})
