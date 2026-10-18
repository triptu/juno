import { describe, expect, it } from 'vitest'
import { HOME_THOUGHTS } from '../src/homeThoughtList'
import { pendingThought, pickThought, prepareThought, SAME_THOUGHT_MILLIS, takeThought, thoughtId, type ThoughtEntry } from '../src/homeThoughts'

const entry = (text: string): ThoughtEntry => ({ text, theme: 'wonder', source: 'test' })
const list = ['One', 'Two', 'Three', 'Four'].map(entry)

describe("Home's thought", () => {
  it('shows every thought once before any repeats, then starts over without the one just shown', () => {
    let seen: ReadonlyArray<string> = []
    const shown: string[] = []
    for (let n = 0; n < list.length; n++) {
      const picked = pickThought(list, seen, 0.99)!
      shown.push(picked.thought.text)
      seen = picked.seen
    }
    expect([...shown].sort()).toEqual(['Four', 'One', 'Three', 'Two'])
    const last = shown.at(-1)!
    for (const random of [0, 0.5, 0.99]) {
      const again = pickThought(list, seen, random, [thoughtId(last)])!
      expect(again.thought.text).not.toBe(last)
      expect(again.seen).toEqual([thoughtId(again.thought.text)])
    }
  })

  it('forgets seen thoughts that left the list', () => {
    const picked = pickThought(list, ['gone', thoughtId('One')], 0)!
    expect(picked.seen).toEqual([thoughtId('One'), thoughtId(picked.thought.text)])
    expect(picked.thought.text).not.toBe('One')
  })

  it('keeps the same thought for a quick return and takes the saved next one after the gap', async () => {
    const start = Date.now()
    // Nothing saved yet: the first Home waits for the list.
    expect(takeThought(start)).toBe('pending')
    const first = await pendingThought(start)
    expect(first?.text).toBeTruthy()
    expect(takeThought(start + 60_000)).toEqual(first)
    // The list saved the next thought, so a Home after the gap has it at once, without the list.
    const later = takeThought(start + SAME_THOUGHT_MILLIS + 1)
    expect(later).not.toBe('pending')
    expect(later).not.toEqual(first)
    await prepareThought()
    expect(takeThought(start + SAME_THOUGHT_MILLIS + 2)).toEqual(later)
  })
})

describe("Home's thought list", () => {
  it('has short, sourced, distinct entries; quotes say who said them', () => {
    const ids = new Set<string>()
    for (const thought of HOME_THOUGHTS) {
      expect(thought.text.length, thought.text).toBeLessThanOrEqual(thought.by === undefined ? 180 : 150)
      expect(thought.text, thought.text).toBe(thought.text.trim())
      expect(thought.source.trim(), thought.text).not.toBe('')
      if (thought.by !== undefined) expect(thought.by.trim(), thought.text).not.toBe('')
      expect(['focus', 'thinking', 'wonder', 'life']).toContain(thought.theme)
      expect(ids.has(thoughtId(thought.text)), thought.text).toBe(false)
      ids.add(thoughtId(thought.text))
    }
  })
})
