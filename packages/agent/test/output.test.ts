// The block format the model writes (plan v3 §8): what becomes a bubble or a reaction, and what never shows.
import { expect, it } from 'vitest'
import { parseOutput } from '../src/index'

it('shows only closed blocks, in order, and never a half-written one', () => {
  expect(parseOutput('thinking <say>One.</say> more <say reply-to="n4"> Two. </say><say>Thr')).toEqual({
    bubbles: [{ text: 'One.' }, { text: 'Two.', replyTo: 'n4' }],
    reactions: [],
  })
})

it('keeps a bubble of any length and drops an empty one', () => {
  const essay = 'A long paragraph. '.repeat(2_000).trim()
  expect(parseOutput(`<say>${essay}</say><say>  </say>`).bubbles).toEqual([{ text: essay }])
})

it('takes a reaction of exactly one emoji, any emoji, and drops anything else', () => {
  expect(parseOutput('<react to="n2">🫡</react><react to="n3">ok</react><react to="n4">👍👍</react><react to="n5">🇮🇳</react>').reactions).toEqual([
    { to: 'n2', emoji: '🫡' },
    { to: 'n5', emoji: '🇮🇳' },
  ])
})
