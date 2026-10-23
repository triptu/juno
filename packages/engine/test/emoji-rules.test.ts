import { describe, expect, it } from 'bun:test'
import { DEFAULT_QUICK_REACTIONS } from '@juno/contract'
import { frequentEmojiNames, slackEmojiUseFrom } from '../src/prefs/emojiRules'

const names = (value: unknown, recent: ReadonlyArray<string> = []) => frequentEmojiNames({
  recent, slackUse: slackEmojiUseFrom(value), quickReactions: DEFAULT_QUICK_REACTIONS,
  custom: [
    { name: 'party_parrot', url: 'https://example.test/parrot.png' },
    { name: 'party_alias', alias_for: 'party_parrot' },
    { name: 'broken_alias', alias_for: 'missing' },
    { name: 'no_image' },
  ],
})

describe('frequent emoji', () => {
  it('puts local picks before combined Slack counts, with canonical names and quick reactions last', () => {
    expect(names(JSON.stringify({
      eyes: 4, tada: 9, party_alias: 6, party_parrot: 5,
      '+1::skin-tone-3': 6, thumbsup: 7, rocket: 1,
      missing: 100, broken_alias: 90, no_image: 80,
    }), ['rocket', 'missing', 'party_alias'])).toEqual([
      'rocket', 'party_alias', '+1', 'tada', 'eyes', 'white_check_mark',
    ])
  })

  it('breaks equal counts by canonical name and skips invalid counts', () => {
    expect(names(JSON.stringify({ tada: 3, rocket: 3, eyes: 0, heart: -1, fire: '90', smile: null }))).toEqual([
      'rocket', 'tada', '+1', 'white_check_mark', 'eyes',
    ])
  })

  it('falls back to quick reactions for missing, empty or malformed prefs', () => {
    for (const value of [undefined, '', 'redacted', 'null', '[]', '{}', '42', '{"rocket":1e400}']) {
      expect(names(value)).toEqual(['+1', 'white_check_mark', 'eyes'])
    }
  })

  it('fills after deleted local names and caps the merged list at 18', () => {
    const recent = ['rocket', 'tada', 'heart', 'smile', 'fire', '100', 'bug', 'wave', 'laughing', 'cry', 'sob', 'thinking_face', 'wink', 'sunglasses', 'clap', 'pray', 'missing']
    expect(names('{"eyes":20,"+1":10,"white_check_mark":5}', recent)).toEqual([...recent.slice(0, 16), 'eyes', '+1'])
  })
})
