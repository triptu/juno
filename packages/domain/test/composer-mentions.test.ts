import { describe, expect, it } from 'vitest'
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

describe('the query being typed', () => {
  it('follows an @ or # at a word start, up to the caret', () => {
    expect(mentionQueryAt('hi @ma', 6)).toEqual({ trigger: '@', start: 3, end: 6, text: 'ma' })
    expect(mentionQueryAt('#', 1)).toEqual({ trigger: '#', start: 0, end: 1, text: '' })
    expect(mentionQueryAt('ask @maya c', 11)?.text).toBe('maya c')
  })

  it('ignores emails, words, other lines and spaces a name cannot have', () => {
    expect(mentionQueryAt('mail leo@eng', 12)).toBeUndefined()
    expect(mentionQueryAt('@ma\nnext', 8)).toBeUndefined()
    expect(mentionQueryAt('#eng infra', 10)).toBeUndefined()
    expect(mentionQueryAt('@maya  chen', 11)).toBeUndefined()
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

  it('shows at most six', () => {
    const many = Array.from({ length: 10 }, (_, i) => person(`p${i}`, 2, i, `Ma ${i}`))
    expect(rankSuggestions(many, '')).toHaveLength(6)
  })
})
