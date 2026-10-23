import { describe, expect, it } from 'bun:test'
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
    const unordered = [glyph('a_smile', 'A'), glyph('smile_z', 'Z')]
    expect(names(matchEmoji(unordered, 'smi', [], []))).toEqual(['smile_z', 'a_smile'])
  })

  it('offers smile for :smi before alphabetically earlier substrings', () => {
    const catalog = [glyph('kissing_smiling_eyes', '😙'), { ...glyph('face_with_hand_over_mouth', '🤭'), aliases: ['smiling_face_with_smiling_eyes_and_hand_covering_mouth'] }, ...rows]
    expect(names(matchEmoji(catalog, 'smi', [], []))[0]).toBe('smile')
  })

  it('offers a frequently used workspace emoji for :part before standard names that start the same', () => {
    const catalog = [glyph('partying_face', '🥳'), glyph('part_alternation_mark', '〽️'), custom('party_parrot')]
    expect(names(matchEmoji(catalog, 'part', ['party_parrot'], []))).toEqual(['part_alternation_mark', 'party_parrot', 'partying_face'])
    expect(names(matchEmoji(catalog, 'part', [], []))).toEqual(['part_alternation_mark', 'partying_face', 'party_parrot'])
  })

  it('offers the common emoji before name order, so thumbs offers 👍 first', () => {
    expect(names(matchEmoji(rows, 'thumbs', [], []))).toEqual(['thumbsup', 'thumbsdown'])
  })

  it('ranks the frequently used first among equal matches, then the quick reactions in their order, aliases included', () => {
    const quick = [{ name: 'smirk', unicode: '😏' }, { name: '+1', unicode: '👍' }]
    expect(names(matchEmoji(rows, 'smi', ['smiley'], quick))).toEqual(['smiley', 'smirk', 'smile', 'sweat_smile'])
    expect(names(matchEmoji(rows, 'thumbs', [], [{ name: 'thumbsdown', unicode: '👎' }]))).toEqual(['thumbsdown', 'thumbsup'])
  })

  it('shows at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => glyph(`face_${i}`, String(i)))
    expect(matchEmoji(many, 'face', [], [])).toHaveLength(8)
  })
})
