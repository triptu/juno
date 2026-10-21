import { describe, expect, it } from 'vitest'
import { THOUGHTS } from '../src/thoughts'

describe('the quotes and facts', () => {
  it('has short, sourced, distinct entries; quotes say who said them', () => {
    const texts = new Set<string>()
    for (const thought of THOUGHTS) {
      expect(thought.text.length, thought.text).toBeLessThanOrEqual(thought.by === undefined ? 200 : 150)
      expect(thought.text, thought.text).toBe(thought.text.trim())
      expect(thought.source.trim(), thought.text).not.toBe('')
      if (thought.by !== undefined) expect(thought.by.trim(), thought.text).not.toBe('')
      expect(['focus', 'thinking', 'wonder', 'life', 'made', 'art']).toContain(thought.theme)
      expect(texts.has(thought.text), thought.text).toBe(false)
      texts.add(thought.text)
    }
  })
})
