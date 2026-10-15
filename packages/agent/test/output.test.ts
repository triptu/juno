// The block format the model writes (plan v3 §8): what becomes a bubble or a reaction, and what never shows.
import { expect, it } from 'vitest'
import { parseOutput } from '../src/index'

it('shows only closed blocks, in order, and never a half-written one', () => {
  expect(parseOutput('thinking <say>One.</say> more <say reply-to="n4"> Two. </say><say>Thr')).toEqual({
    bubbles: [{ text: 'One.', spans: [{ text: 'One.' }] }, { text: 'Two.', spans: [{ text: 'Two.' }], replyTo: 'n4' }],
    reactions: [],
  })
})

it('keeps a bubble of any length and drops an empty one', () => {
  const essay = 'A long paragraph. '.repeat(2_000).trim()
  expect(parseOutput(`<say>${essay}</say><say>  </say>`).bubbles).toEqual([{ text: essay, spans: [{ text: essay }] }])
})

it('takes a reaction of exactly one emoji, any emoji, and drops anything else', () => {
  expect(parseOutput('<react to="n2">🫡</react><react to="n3">ok</react><react to="n4">👍👍</react><react to="n5">🇮🇳</react>').reactions).toEqual([
    { to: 'n2', emoji: '🫡' },
    { to: 'n5', emoji: '🇮🇳' },
  ])
})

it('shows a source as its words, and keeps the handle the model wrote', () => {
  expect(parseOutput('<say>It moved to <src m="m3">Thursday at 14:00</src>, same room.</say>').bubbles).toEqual([
    {
      text: 'It moved to Thursday at 14:00, same room.',
      spans: [{ text: 'It moved to ' }, { text: 'Thursday at 14:00', source: 'm3' }, { text: ', same room.' }],
    },
  ])
})

it('never shows a stray tag inside a bubble', () => {
  expect(parseOutput('<say>One <src m="m1">open, <say>nested</say>').bubbles.map((b) => b.text)).toEqual(['One open, nested'])
  expect(parseOutput('<say>Done.</src> <react to="n1">👍</react></say>').bubbles.map((b) => b.text)).toEqual(['Done. '])
})
