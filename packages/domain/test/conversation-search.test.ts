import { describe, expect, it } from 'bun:test'
import { indexSubject, matchSubject, rankSearchResults, searchWords, type SearchSubject } from '../src/conversation-search'

const DAY = 86_400_000
const now = 40 * DAY

const dmitriy = ['Dmitriy', 'Dmitriy Vasilyuk', 'dvasilyuk']
const wience = ['wience', 'Wience Ortega', 'wience']
const maya = ['Maya', 'Maya Chen', 'maya.chen']

const group = indexSubject({ id: 'G1', kind: 'mpim', name: 'Dmitriy, wience', people: [dmitriy, wience] })
const dm = indexSubject({ id: 'D1', kind: 'im', name: 'Dmitriy Vasilyuk', people: [dmitriy] })
const mobile = indexSubject({ id: 'C1', kind: 'public', name: 'proj-mobile-app', people: [] })
const snake = indexSubject({ id: 'C2', kind: 'private', name: 'release_train', people: [] })
const mayaDm = indexSubject({ id: 'D2', kind: 'im', name: 'Maya Chen', people: [maya] })

const match = (subject: ReturnType<typeof indexSubject>, text: string) => matchSubject(subject, searchWords(text))

describe('conversation search matching', () => {
  it.each([
    // The owner's cases: word order and punctuation do not matter.
    ['dmitriy', group, 1],
    ['dmitriy wi', group, 1],
    ['wi dmitriy', group, 1],
    ['dmitriy, wi', group, 1],
    ['DMITRIY   WI', group, 1],
    // Two letters swapped in a short word, and a short prefix.
    ['dim wie', group, 3],
    // Members' real names and handles, not only the label.
    ['vasilyuk', dm, 1],
    ['vasilyuk', group, 1],
    ['ortega', group, 1],
    ['dvas', group, 1],
    ['chen', mayaDm, 1],
    // Channel words split at "-" and "_".
    ['mobile', mobile, 1],
    ['app proj', mobile, 1],
    ['train', snake, 1],
    // Exact names.
    ['proj-mobile-app', mobile, 0],
    ['maya chen', mayaDm, 0],
    ['maya', mayaDm, 0],
    ['dmitriy wience', group, 0],
    // Inside a word.
    ['obil', mobile, 2],
    // One typo in a word of 4 or more letters.
    ['vasilyik', dm, 3],
    ['mobel', mobile, 3],
  ] as const)('"%s" matches at tier %#', (text, subject, tier) => {
    expect(match(subject, text)?.tier).toBe(tier)
  })

  it.each([
    ['dmitriy zz', group],
    ['mob x', mobile],
    // A short word gets no typo other than a swap, and not inside a word.
    ['mab', mobile],
    ['bil', snake],
    // Two typos are too many.
    ['vasiliik', dm],
  ] as const)('"%s" does not match', (text, subject) => {
    expect(match(subject, text)).toBeUndefined()
  })

  it('highlights the matched parts of the name', () => {
    expect(match(group, 'wi dmitriy')?.ranges).toEqual([
      [0, 7],
      [9, 11],
    ])
    expect(match(mobile, 'mobile')?.ranges).toEqual([[5, 11]])
    // A match through a member's real name highlights nothing in the label.
    expect(match(group, 'ortega')?.ranges).toEqual([])
  })

  it('counts the typed words matched by different people', () => {
    expect(match(group, 'dmitriy wi')?.people).toBe(2)
    expect(match(group, 'dmitriy vasilyuk')?.people).toBe(1)
  })
})

describe('conversation search ranking', () => {
  const result = (subject: SearchSubject, text: string, lastActivityAt = 0) => {
    const found = matchSubject(indexSubject(subject), searchWords(text))
    if (found === undefined) throw new Error(`${subject.id} does not match ${text}`)
    return { id: subject.id, kind: subject.kind, lastActivityAt, match: found }
  }

  it('ranks the exact name, then prefixes, then inside a word, then typos', () => {
    const subjects: ReadonlyArray<SearchSubject> = [
      { id: 'typo', kind: 'public', name: 'markting', people: [] },
      { id: 'inside', kind: 'public', name: 'pmarket', people: [] },
      { id: 'prefix', kind: 'public', name: 'marketing-team', people: [] },
      { id: 'exact', kind: 'public', name: 'market', people: [] },
    ]
    expect(rankSearchResults(subjects.map((subject) => result(subject, 'market')), [], now)).toEqual(['exact', 'prefix', 'inside', 'typo'])
  })

  it('puts DMs before group DMs before channels when nothing else differs, and used ones first', () => {
    const results = [
      result({ id: 'channel', kind: 'public', name: 'dmitriy-notes', people: [] }, 'dmi', now),
      result({ id: 'group', kind: 'mpim', name: 'Dmitriy, wience', people: [dmitriy, wience] }, 'dmi', now),
      result({ id: 'dm', kind: 'im', name: 'Dmitriy Vasilyuk', people: [dmitriy] }, 'dmi'),
    ]
    expect(rankSearchResults(results, [], now)).toEqual(['dm', 'group', 'channel'])
    expect(rankSearchResults(results, [{ channel: 'channel', at: now - DAY }], now)).toEqual(['channel', 'dm', 'group'])
  })

  it('ranks a group DM whose people match more of the typed words higher', () => {
    const results = [
      result({ id: 'one', kind: 'mpim', name: 'Dmitriy Williams, Leo', people: [['Dmitriy Williams'], ['Leo']] }, 'dmitriy wi', now),
      result({ id: 'two', kind: 'mpim', name: 'Dmitriy, wience', people: [dmitriy, wience] }, 'dmitriy wi'),
    ]
    expect(rankSearchResults(results, [], now)).toEqual(['two', 'one'])
  })

  it('breaks the rest by activity', () => {
    const results = [result({ id: 'older', kind: 'public', name: 'eng-old', people: [] }, 'eng', 1), result({ id: 'newer', kind: 'public', name: 'eng-new', people: [] }, 'eng', 2)]
    expect(rankSearchResults(results, [], now)).toEqual(['newer', 'older'])
  })
})
