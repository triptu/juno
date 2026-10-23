import { describe, expect, it } from 'bun:test'
import { asksUser, followUpDelivery, isOldDraft, isQuestion, OLD_DRAFT_MILLIS, rankHomeItems, settledEvidence, type HomeCandidate, type LaterMessage } from '../src/home'

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

  it('ranks a mention in an ignored channel after a question, and the other suggestions after Tidy up, each from one topic', () => {
    const ranked = rankHomeItems([item('ignore', 'm'), item('unfollow', 't'), item('mentioned', 'x'), item('waiting', 'a')], 9)
    expect(ranked.map((row) => row.kind)).toEqual(['waiting', 'mentioned', 'unfollow', 'ignore'])
    expect(rankHomeItems([item('tidyUp', 'a', 'b'), item('unfollow', 'a')], 9).map((row) => row.kind)).toEqual(['tidyUp'])
  })

  it("asks Automated's question after a follow-up and before Tidy up", () => {
    const ranked = rankHomeItems([item('tidyUp', 'x', 'y'), item('automated', 'm'), item('followUp', 'c'), item('waiting', 'd')])
    expect(ranked.map((row) => row.value)).toEqual(['waiting:d', 'followUp:c', 'automated:m'])
  })
})

describe('Why a topic looks settled', () => {
  const me = 'U0ME'
  const msg = (user_id: string | null, text: string) => ({ user_id, text })

  it('names the closing message: a thank-you, done, or an OK', () => {
    expect(settledEvidence([msg('U0MAYA', 'Thanks, that fixed it')], me, false)).toEqual({ kind: 'thanks', by: 'U0MAYA' })
    expect(settledEvidence([msg('U0DEV', 'Merged to main')], me, false)).toEqual({ kind: 'done', by: 'U0DEV' })
    expect(settledEvidence([msg('U0PRIYA', 'sounds good'), msg(me, 'Ship it Friday then')], me, false)).toEqual({ kind: 'agreed', by: 'U0PRIYA' })
    expect(settledEvidence([msg('U0PRIYA', ':+1:')], me, false)).toEqual({ kind: 'agreed', by: 'U0PRIYA' })
    expect(settledEvidence([msg(me, 'thanks all')], me, false)).toEqual({ kind: 'thanks' })
    expect(settledEvidence([msg(me, 'Thanks both. Postmortem in the usual doc, no rush.'), msg('U0DEV', 'Confirmed, p95 back to 210ms.')], me, false)).toEqual({ kind: 'thanks' })
  })

  it('does not count a denied or asked closing word', () => {
    expect(settledEvidence([msg('U0DEV', 'not merged yet')], me, false)).toEqual({ kind: 'quiet', by: 'U0DEV' })
    expect(settledEvidence([msg('U0DEV', 'is it deployed?')], me, false)).toEqual({ kind: 'quiet', by: 'U0DEV' })
    expect(settledEvidence([msg('U0DEV', 'ok so the next thing we need to figure out is how the billing export handles refunds')], me, false)).toEqual({ kind: 'quiet', by: 'U0DEV' })
  })

  it('says when the user wrote last, after someone else', () => {
    expect(settledEvidence([msg(me, 'The p95 is back under 300ms'), msg('U0SAM', 'Search is slow again')], me, false)).toEqual({ kind: 'afterYou' })
    expect(settledEvidence([msg(me, 'Note to self: rotate keys')], me, false)).toEqual({ kind: 'quiet' })
  })

  it('never proposes a topic with a question waiting on the user', () => {
    expect(settledEvidence([msg('U0SAM', 'thanks'), msg('U0SAM', `<@${me}> can you sign off?`)], me, false)).toBeUndefined()
    expect(settledEvidence([msg('U0SAM', 'can you sign off?')], me, true)).toBeUndefined()
    expect(settledEvidence([msg('U0SAM', 'thanks'), msg(me, 'Signed off'), msg('U0SAM', `<@${me}> can you sign off?`)], me, false)).toEqual({ kind: 'thanks', by: 'U0SAM' })
  })

  it('never proposes a topic whose last message mentions the user', () => {
    expect(settledEvidence([msg('U0SAM', `done, <@${me}> fyi`)], me, false)).toBeUndefined()
  })

  it('reads only messages people wrote', () => {
    expect(settledEvidence([msg(null, 'joined the channel')], me, false)).toBeUndefined()
    expect(settledEvidence([msg(null, 'Deploy finished'), msg('U0DEV', 'Shipped')], me, false)).toEqual({ kind: 'done', by: 'U0DEV' })
  })
})

describe('A follow-up that looks done', () => {
  const PROMISE = '1760000000.000100'
  const mine = (ts: string, text: string, files = 0): LaterMessage => ({ ts, user_id: 'U0ME', text, files })

  it('takes your first later message with a file, a link, or words that hand it over', () => {
    expect(followUpDelivery(PROMISE, [mine('1760000100.000000', 'deck-v3', 1)], 'U0ME')).toEqual({ ts: '1760000100.000000', kind: 'file' })
    expect(followUpDelivery(PROMISE, [mine('1760000100.000000', 'Draft: <https://docs.example.com/d/42|plan>')], 'U0ME')).toEqual({ ts: '1760000100.000000', kind: 'link' })
    expect(followUpDelivery(PROMISE, [mine('1760000100.000000', "Here's the deck, slide 4 has the numbers")], 'U0ME')).toMatchObject({ kind: 'said' })
    expect(followUpDelivery(PROMISE, [mine('1760000100.000000', 'Done.')], 'U0ME')).toMatchObject({ kind: 'said' })
    const two = [mine('1760000300.000000', 'Attached'), mine('1760000200.000000', 'Sent it over')]
    expect(followUpDelivery(PROMISE, two, 'U0ME')?.ts).toBe('1760000200.000000')
  })

  it("ignores other people's messages, messages before the promise, denials and questions", () => {
    expect(followUpDelivery(PROMISE, [{ ts: '1760000100.000000', user_id: 'U0DEV', text: "Here's mine", files: 1 }], 'U0ME')).toBeUndefined()
    expect(followUpDelivery(PROMISE, [mine('1759999999.000000', 'Here it is', 1)], 'U0ME')).toBeUndefined()
    expect(followUpDelivery(PROMISE, [mine('1760000100.000000', 'Not done yet, sorry')], 'U0ME')).toBeUndefined()
    expect(followUpDelivery(PROMISE, [mine('1760000100.000000', 'Here is the thing: should it include Q3?')], 'U0ME')).toBeUndefined()
    expect(followUpDelivery(PROMISE, [mine('1760000100.000000', 'Doneness is subjective')], 'U0ME')).toBeUndefined()
    expect(followUpDelivery(PROMISE, [mine('1760000100.000000', 'Working on it')], 'U0ME')).toBeUndefined()
  })

  it('after Not done, proposes only a newer match', () => {
    const messages = [mine('1760000100.000000', 'Here you go', 1), mine('1760000400.000000', 'Here is the final one', 1)]
    expect(followUpDelivery(PROMISE, messages, 'U0ME', '1760000100.000000')?.ts).toBe('1760000400.000000')
    expect(followUpDelivery(PROMISE, messages.slice(0, 1), 'U0ME', '1760000100.000000')).toBeUndefined()
  })
})

describe('An old draft', () => {
  const NOW = 1_800_000_000_000
  const DAY = 86_400_000

  it('is untouched for two weeks, in a topic that moved on since', () => {
    const updatedAt = NOW - 15 * DAY
    expect(isOldDraft({ updatedAt }, updatedAt + DAY, NOW)).toBe(true)
    expect(isOldDraft({ updatedAt: NOW - OLD_DRAFT_MILLIS + 1 }, NOW, NOW)).toBe(false)
    // Nothing happened in the topic after it: the draft may still be the next thing to say.
    expect(isOldDraft({ updatedAt }, updatedAt - DAY, NOW)).toBe(false)
    expect(isOldDraft({ updatedAt }, undefined, NOW)).toBe(false)
  })

  it('stays kept until the draft changes', () => {
    const updatedAt = NOW - 20 * DAY
    expect(isOldDraft({ updatedAt, keptAt: updatedAt }, NOW, NOW)).toBe(false)
    expect(isOldDraft({ updatedAt, keptAt: updatedAt - DAY }, NOW, NOW)).toBe(true)
  })
})

describe('Ranking the review cards', () => {
  it('puts them after Tidy up, and keeps one with a single topic left', () => {
    const ranked = rankHomeItems([item('oldDrafts', 'a', 'b'), item('doneFollowUps', 'c'), item('waiting', 'a')])
    expect(ranked.map((row) => [row.kind, row.topicIds])).toEqual([
      ['waiting', ['a']],
      ['doneFollowUps', ['c']],
      ['oldDrafts', ['b']],
    ])
    expect(rankHomeItems([item('waiting', 'a'), item('oldDrafts', 'a')])).toHaveLength(1)
  })
})
