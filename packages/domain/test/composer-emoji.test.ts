import { describe, expect, it } from 'vitest'
import { customEmoji, emojiQueryAt, matchEmoji, mergeEmoji, type EmojiChoice } from '../src/index'

const glyph = (name: string, insert: string): EmojiChoice => ({ id: name, name, insert })
const names = (found: ReadonlyArray<EmojiChoice>) => found.map((row) => row.name)
const custom = (name: string): EmojiChoice => ({ id: name, name, insert: `:${name}:`, url: `https://emoji.example/${name}.png` })

describe('the colon query being typed', () => {
  it('follows a colon at a word start, up to the caret, lowercased', () => {
    expect(emojiQueryAt(':ありがとう', 6)?.text).toBe('ありがとう')
    expect(emojiQueryAt(':smi', 4)).toEqual({ start: 0, end: 4, text: 'smi' })
    expect(emojiQueryAt('Looking good :SMI', 17)).toEqual({ start: 13, end: 17, text: 'smi' })
    expect(emojiQueryAt('ok (:+1', 7)?.text).toBe('+1')
    expect(emojiQueryAt(':smile: and', 4)?.text).toBe('smi')
  })

  it('ignores a colon inside a word, after another colon, after a space, or with nothing after it', () => {
    expect(emojiQueryAt('time:smi', 8)).toBeUndefined()
    expect(emojiQueryAt('12:30', 5)).toBeUndefined()
    expect(emojiQueryAt('::smi', 5)).toBeUndefined()
    expect(emojiQueryAt(':smi le', 7)).toBeUndefined()
    expect(emojiQueryAt('say :', 5)).toBeUndefined()
    expect(emojiQueryAt('no colon', 8)).toBeUndefined()
  })
})

describe('workspace emoji', () => {
  it('resolves aliases to their target’s image and drops what has none, in name order', () => {
    expect(customEmoji([
      { name: 'wave_hello', url: null, alias_for: 'wave' },
      { name: 'wave', url: 'https://emoji.example/wave.png', alias_for: null },
      { name: 'lost', url: null, alias_for: 'gone' },
      { name: 'loop_a', url: null, alias_for: 'loop_b' },
      { name: 'loop_b', url: null, alias_for: 'loop_a' },
    ])).toEqual([
      { name: 'wave', canonical: 'wave', url: 'https://emoji.example/wave.png' },
      { name: 'wave_hello', canonical: 'wave', url: 'https://emoji.example/wave.png' },
    ])
  })

  it('merge into the standard list in name order, a custom name replacing the standard one', () => {
    const standard = [glyph('a', 'A'), glyph('c', 'C'), glyph('e', 'E')]
    expect(mergeEmoji(standard, [custom('b'), custom('c'), custom('z')]).map((row) => row.insert)).toEqual(['A', ':b:', ':c:', 'E', ':z:'])
    expect(mergeEmoji(standard, [])).toBe(standard)
  })
})

describe('matching', () => {
  const rows = [
    glyph('smile', '😄'),
    glyph('smiley', '😃'),
    glyph('smirk', '😏'),
    glyph('sweat_smile', '😅'),
    glyph('thumbsdown', '👎'),
    glyph('thumbsup', '👍'),
    glyph('+1', '👍'),
    glyph('tada', '🎉'),
  ]

  it('puts names that start with the query before names that contain it', () => {
    expect(names(matchEmoji(rows, 'smi', [], []))).toEqual(['smile', 'smiley', 'smirk', 'sweat_smile'])
  })

  it('offers the common emoji before name order, so thumbs offers 👍 first', () => {
    expect(names(matchEmoji(rows, 'thumbs', [], []))).toEqual(['thumbsup', 'thumbsdown'])
  })

  it('ranks the recently used first, then the quick reactions in their order, aliases included', () => {
    const quick = [{ name: 'smirk', unicode: '😏' }, { name: '+1', unicode: '👍' }]
    expect(names(matchEmoji(rows, 'smi', ['sweat_smile'], quick))).toEqual(['sweat_smile', 'smirk', 'smile', 'smiley'])
    expect(names(matchEmoji(rows, 'thumbs', [], [{ name: 'thumbsdown', unicode: '👎' }]))).toEqual(['thumbsdown', 'thumbsup'])
  })

  it('shows at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => glyph(`face_${i}`, String(i)))
    expect(matchEmoji(many, 'face', [], [])).toHaveLength(8)
  })
})
