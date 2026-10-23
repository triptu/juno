// The block format the model writes (plan v3 §8): what becomes a bubble or a reaction, and what never shows.
import { expect, it } from 'bun:test'
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

it('reads the short form <src m3> as a source too', () => {
  expect(parseOutput('<say><src m3>Thursday at 14:00</src>, and <src m12 >room 4</src>.</say>').bubbles[0]!.spans).toEqual([
    { text: 'Thursday at 14:00', source: 'm3' },
    { text: ', and ' },
    { text: 'room 4', source: 'm12' },
    { text: '.' },
  ])
})

it('never shows a handle: a malformed source keeps only its words', () => {
  const texts = parseOutput(
    "<say>A <src m='m3'>single-quoted</src> one, a <src m=\"m4\"/>closed one, a <src>bare</src> one and <src m=\"m5\" >a spaced</src> one.</say>",
  ).bubbles.map((b) => b.text)
  expect(texts).toEqual(['A single-quoted one, a closed one, a bare one and a spaced one.'])
})

it('never shows a stray tag inside a bubble', () => {
  expect(parseOutput('<say>One <src m="m1">open, <say>nested</say>').bubbles.map((b) => b.text)).toEqual(['One open, nested'])
  expect(parseOutput('<say>Done.</src> <react to="n1">👍</react></say>').bubbles.map((b) => b.text)).toEqual(['Done. '])
})
