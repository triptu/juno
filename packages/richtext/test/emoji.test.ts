import { describe, expect, it } from 'bun:test'
import { workspaceEmoji, customEmojiLookup, emojiCatalog, PICKER_EMOJI, QUICK_REACTIONS, emojiUnicode, reactionDisplay, splitEmojiName, unicodeFromHex } from '../src/index'

const custom = (name: string) => (name === 'partyparrot' ? 'https://x/p.gif' : undefined)

describe('emoji table', () => {
  it('draws every quick reaction and picker emoji', () => {
    for (const name of [...QUICK_REACTIONS, ...PICKER_EMOJI]) expect(emojiUnicode(name), name).toMatch(/\p{Extended_Pictographic}/u)
  })

  // Slack numbers tones 2 to 6 for U+1F3FB to U+1F3FF; in a joined sequence the tone goes on the person.
  it.each([
    ['+1::skin-tone-4', '👍🏽'],
    ['woman-raising-hand::skin-tone-2', '🙋🏻‍♀️'],
    ['flag-gb', '🇬🇧'],
    ['uk', '🇬🇧'],
    ['not_an_emoji', undefined],
  ])('draws %s', (name, unicode) => {
    expect(emojiUnicode(name)).toBe(unicode)
  })

  it('splits a skin tone off a name and rejects bad hex', () => {
    expect(splitEmojiName('+1::skin-tone-4')).toEqual({ name: '+1', skinTone: 4 })
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
