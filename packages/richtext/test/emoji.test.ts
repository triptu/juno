import { describe, expect, it } from 'vitest'
import { workspaceEmoji, customEmojiLookup, emojiCatalog, PICKER_EMOJI, QUICK_REACTIONS, emojiUnicode, reactionDisplay, splitEmojiName, unicodeFromHex } from '../src/index'

const custom = (name: string) => (name === 'partyparrot' ? 'https://x/p.gif' : undefined)

describe('emoji table', () => {
  it('draws every quick reaction and picker emoji', () => {
    for (const name of [...QUICK_REACTIONS, ...PICKER_EMOJI]) expect(emojiUnicode(name), name).toMatch(/\p{Extended_Pictographic}/u)
  })

  it('treats +1 and thumbsup as the same emoji', () => {
    expect(emojiUnicode('+1')).toBe(emojiUnicode('thumbsup'))
  })

  it('applies skin tones', () => {
    expect(splitEmojiName('+1::skin-tone-4')).toEqual({ name: '+1', skinTone: 4 })
    // Slack numbers tones 2 to 6 for U+1F3FB to U+1F3FF.
    expect(emojiUnicode('+1::skin-tone-4')).toBe('👍🏽')
    expect(emojiUnicode('wave::skin-tone-2')).toBe('👋🏻')
  })

  it('knows every standard emoji by its Slack name and aliases', () => {
    expect(emojiUnicode('partying_face')).toBe('🥳')
    expect(emojiUnicode('flag-gb')).toBe(emojiUnicode('uk'))
    expect(emojiUnicode('email')).toBe('✉️')
  })

  it('puts the skin tone on the person in a joined sequence', () => {
    expect(emojiUnicode('woman-raising-hand::skin-tone-2')).toBe('🙋🏻‍♀️')
  })

  it('returns undefined for unknown names', () => {
    expect(emojiUnicode('not_an_emoji')).toBeUndefined()
  })

  it('decodes the hex form Slack sends', () => {
    expect(unicodeFromHex('1f44d')).toBe('👍')
    expect(unicodeFromHex('1f44d-1f3fd')).toBe('👍🏽')
    expect(unicodeFromHex('zz')).toBeUndefined()
  })

  it('picks what a reaction chip shows', () => {
    expect(reactionDisplay('white_check_mark', custom)).toEqual({ kind: 'unicode', value: '✅' })
    expect(reactionDisplay('partyparrot', custom)).toEqual({ kind: 'image', url: 'https://x/p.gif' })
    expect(reactionDisplay('mystery', custom)).toEqual({ kind: 'name', value: 'mystery' })
  })
})


describe('workspace aliases', () => {
  const rows = [
    { name: 'wave', url: 'https://emoji.example/wave.png' },
    { name: 'hello', alias_for: 'wave' },
    { name: 'greeting', alias_for: 'hello' },
    { name: 'hey', url: 'https://emoji.example/alias.png', alias_for: 'wave' },
    { name: 'approval', alias_for: 'thumbsup' },
    { name: 'cycle_a', alias_for: 'cycle_b' },
    { name: 'cycle_b', alias_for: 'cycle_a' },
    { name: 'lost', alias_for: 'gone' },
    { name: 'empty', url: '' },
  ]
  it('groups image aliases, resolves standard aliases, and omits cycles and missing targets', () => {
    expect(workspaceEmoji(rows, emojiCatalog)).toMatchObject([
      { name: '+1', unicode: '👍', aliases: ['approval'] },
      { name: 'wave', url: 'https://emoji.example/wave.png', aliases: ['hello', 'greeting', 'hey'] },
    ])
    const lookup = customEmojiLookup(rows)
    expect(lookup('greeting')).toBe('https://emoji.example/wave.png')
    expect(lookup('hey')).toBe('https://emoji.example/wave.png')
    for (const name of ['cycle_a', 'cycle_b', 'lost', 'empty', 'approval']) expect(lookup(name)).toBeUndefined()
  })
})
