import { describe, expect, it } from 'vitest'
import { asksUser, isQuestion, rankHomeItems, type HomeCandidate } from '../src/home'

const item = (kind: HomeCandidate<string>['kind'], ...topicIds: string[]): HomeCandidate<string> => ({ kind, topicIds, value: `${kind}:${topicIds.join(',')}` })

describe('Home items', () => {
  it('reads a question past trailing spaces, quotes and emoji', () => {
    expect(isQuestion('Can we ship Friday?')).toBe(true)
    expect(isQuestion('Can we ship Friday?  ')).toBe(true)
    expect(isQuestion('Can we ship Friday? 🙏')).toBe(true)
    expect(isQuestion('(is that ok?)')).toBe(true)
    expect(isQuestion('Shipping Friday.')).toBe(false)
    expect(isQuestion('Why? Because it is ready.')).toBe(false)
  })

  it('asks the user when the question mentions them, or in a DM without a mention', () => {
    expect(asksUser({ text: '<@U0ME> can you review?' }, 'U0ME', false)).toBe(true)
    expect(asksUser({ text: 'can someone review?' }, 'U0ME', false)).toBe(false)
    expect(asksUser({ text: 'can you review?' }, 'U0ME', true)).toBe(true)
    expect(asksUser({ text: '<@U0ME> reviewed it.' }, 'U0ME', true)).toBe(false)
  })

  it('ranks by kind, one of each, three at most', () => {
    const ranked = rankHomeItems([item('moved', 'a'), item('moved', 'b'), item('followUp', 'c'), item('waiting', 'd'), item('resume', 'e')])
    expect(ranked.map((row) => row.value)).toEqual(['waiting:d', 'resume:e', 'moved:a'])
    expect(rankHomeItems([item('moved', 'a'), item('waiting', 'd'), item('resume', 'e')], 2).map((row) => row.value)).toEqual(['waiting:d', 'resume:e'])
  })

  it('shows a topic once, under its higher kind, and the next candidate of a kind takes the slot', () => {
    const ranked = rankHomeItems([item('waiting', 'a'), item('resume', 'a'), item('moved', 'a'), item('moved', 'b')])
    expect(ranked.map((row) => row.value)).toEqual(['waiting:a', 'moved:b'])
  })

  it('keeps Tidy up only with two topics left after the others', () => {
    expect(rankHomeItems([item('waiting', 'a'), item('tidyUp', 'a', 'b')])).toHaveLength(1)
    const ranked = rankHomeItems([item('waiting', 'a'), item('tidyUp', 'a', 'b', 'c')])
    expect(ranked[1]).toMatchObject({ kind: 'tidyUp', topicIds: ['b', 'c'] })
  })
})
