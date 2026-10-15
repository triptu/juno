import { describe, expect, it } from 'vitest'
import { PICKER_EMOJI, QUICK_REACTIONS, emojiUnicode, reactionDisplay, splitEmojiName, unicodeFromHex } from '../src/index'

const custom = (name: string) => (name === 'partyparrot' ? 'https://x/p.gif' : undefined)

describe('emoji table', () => {
  it('knows the quick reactions and the picker', () => {
    expect(QUICK_REACTIONS.map(emojiUnicode)).toEqual(['👍', '✅', '👀'])
    expect(PICKER_EMOJI.map(emojiUnicode)).toEqual(['👍', '❤️', '😂', '🎉', '👀', '✅', '🙏', '🔥', '💯', '😮', '😢', '🚀'])
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
