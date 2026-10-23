import { describe, expect, it } from 'bun:test'
import {
  decodeMentions,
  encodeMentions,
  insertMention,
  mentionQueryAt,
  mentionTokens,
  picksIn,
  rankSuggestions,
  removeTokenBefore,
  type MentionPick,
} from '../src/index'

const maya: MentionPick = { kind: 'person', id: 'U0MAYA', name: 'Maya' }
const mayaChen: MentionPick = { kind: 'person', id: 'U0MAYA2', name: 'Maya Chen' }
const eng: MentionPick = { kind: 'channel', id: 'C0ENG', name: 'eng' }
const design: MentionPick = { kind: 'group', id: 'S0DESIGN', name: 'design-team' }

describe('the query being typed', () => {
  // An @ or # at a word start, up to the caret. Not an email, a word, another line, or spaces a name cannot have.
  it.each<[string, number, ReturnType<typeof mentionQueryAt>]>([
    ['hi @ma', 6, { trigger: '@', start: 3, end: 6, text: 'ma' }],
    ['#', 1, { trigger: '#', start: 0, end: 1, text: '' }],
    ['ask @maya c', 11, { trigger: '@', start: 4, end: 11, text: 'maya c' }],
    ['mail leo@eng', 12, undefined],
    ['@ma\nnext', 8, undefined],
    ['#eng infra', 10, undefined],
    ['@maya  chen', 11, undefined],
  ])('%j at %i', (text, caret, query) => {
    expect(mentionQueryAt(text, caret)).toEqual(query)
  })

  it('does not reopen on a token already picked', () => {
    const text = 'hi @Maya'
    expect(mentionQueryAt(text, text.length, mentionTokens(text, [maya]))).toBeUndefined()
  })
})

describe('picked names in the text', () => {
  it('finds whole names only, the longest first', () => {
    const text = '@Maya Chen and @Maya, not @Mayan or x@Maya, see #eng.'
    expect(mentionTokens(text, [maya, mayaChen, eng]).map((t) => text.slice(t.start, t.end))).toEqual(['@Maya Chen', '@Maya', '#eng'])
  })

  it('a pick replaces the query with the name and one space', () => {
    expect(insertMention('hi @ma', { trigger: '@', start: 3, end: 6, text: 'ma' }, maya)).toEqual({ text: 'hi @Maya ', caret: 9 })
    expect(insertMention('#en today', { trigger: '#', start: 0, end: 3, text: 'en' }, eng)).toEqual({ text: '#eng today', caret: 5 })
  })

  it('backspace at the end of a token, or inside it, removes it whole', () => {
    const text = 'hi @Maya Chen ok'
    const tokens = mentionTokens(text, [mayaChen])
    expect(removeTokenBefore(text, 13, tokens)).toEqual({ text: 'hi  ok', caret: 3 })
    expect(removeTokenBefore(text, 6, tokens)).toEqual({ text: 'hi  ok', caret: 3 })
    expect(removeTokenBefore(text, 14, tokens)).toBeUndefined()
    expect(removeTokenBefore(text, 3, tokens)).toBeUndefined()
  })

  it('a token typed into is plain text again', () => {
    expect(picksIn('hi @Mayx', [maya])).toEqual([])
    expect(picksIn('hi @Maya', [maya, eng])).toEqual([maya])
  })
})

describe('drafts and sends', () => {
  it('encode picks as Slack does and decode them back', () => {
    const text = 'ask @Maya Chen in #eng about <b>'
    const encoded = encodeMentions(text, [mayaChen, eng])
    expect(encoded).toBe('ask <@U0MAYA2|Maya Chen> in <#C0ENG|eng> about <b>')
    expect(decodeMentions(encoded)).toEqual({ text, picks: [mayaChen, eng] })
    expect(decodeMentions('plain')).toEqual({ text: 'plain', picks: [] })
  })

  it('a user group shows as its handle and goes as a subteam mention', () => {
    const text = 'cc @design-team and @Maya'
    expect(mentionTokens(text, [design, maya]).map((t) => text.slice(t.start, t.end))).toEqual(['@design-team', '@Maya'])
    const encoded = encodeMentions(text, [design, maya])
    expect(encoded).toBe('cc <!subteam^S0DESIGN|@design-team> and <@U0MAYA|Maya>')
    expect(decodeMentions(encoded)).toEqual({ text, picks: [design, maya] })
  })

  it('keeps an italic picked mention and its id (regression)', () => {
    expect(mentionTokens('_@Maya Chen_', [mayaChen])).toHaveLength(1)
    expect(encodeMentions('_@Maya Chen_', [mayaChen])).toBe('_<@U0MAYA2|Maya Chen>_')
  })
})

describe('ranking', () => {
  const person = (id: string, tier: number, order: number, ...names: string[]) => ({ id, tier, order, names })
  const people = [
    person('everyone', 2, 0, 'Mark', 'Mark Ito', 'mark'),
    person('recent', 1, 0, 'Sam', 'Sam Okafor', 'sam.ma'),
    person('here-late', 0, 1, 'Tomás', 'Tomás Mañez', 'tomas'),
    person('here', 0, 0, 'Maya', 'Maya Chen', 'maya'),
  ]

  it('puts this conversation first, then recent contacts, then everyone', () => {
    expect(rankSuggestions(people, 'ma').map((p) => p.id)).toEqual(['here', 'here-late', 'recent', 'everyone'])
  })

  it('matches display name, real name and handle by word start, ignoring accents', () => {
    expect(rankSuggestions(people, 'manez').map((p) => p.id)).toEqual(['here-late'])
    expect(rankSuggestions(people, 'okafor').map((p) => p.id)).toEqual(['recent'])
    expect(rankSuggestions(people, 'maya c').map((p) => p.id)).toEqual(['here'])
    expect(rankSuggestions(people, 'zed')).toEqual([])
  })
})
