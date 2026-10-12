import { describe, expect, it } from 'vitest'
import { UserId, confidenceLabel, parseCommand, threadTopicId, type CommandContext } from '../src/index'
import { eng, hiring, maya, mayaId, ts, NOW } from './fixtures'

const ctx: CommandContext = {
  people: [
    { id: mayaId, name: 'Maya Chen' },
    { id: UserId.make('U0JONAS'), name: 'Jonas Weber' },
    { id: UserId.make('U0MAYA2'), name: 'Maya Lindqvist' },
  ],
  channels: [eng, hiring, maya],
  topics: [
    { id: threadTopicId(eng.id, ts(NOW - 1000)), title: 'Pricing page copy', channel: { ...eng, name: 'product' } },
    { id: threadTopicId(eng.id, ts(NOW - 2000)), title: 'Staging bill doubled since August', channel: eng },
  ],
}

describe('⌘K commands', () => {
  it('turns "tell maya …" into a send with the text, a label and a confidence', () => {
    const c = parseCommand('tell maya the wednesday slot works', ctx)
    expect(c).toEqual({
      kind: 'send-dm',
      userId: mayaId,
      text: 'the wednesday slot works',
      label: 'Send to Maya Chen',
      sub: '"the wednesday slot works"',
      confidence: 0.75,
      hint: '↵ Send',
    })
  })

  it('accepts message, ask, dm, ping and text as verbs, and drops a leading "that" or "to"', () => {
    expect(parseCommand('message Jonas that the build is green', ctx)).toMatchObject({ kind: 'send-dm', text: 'the build is green', confidence: 0.95 })
    expect(parseCommand('ping jonas to check staging', ctx)).toMatchObject({ kind: 'send-dm', text: 'check staging' })
    expect(parseCommand('dm Jonas Weber hi', ctx)).toMatchObject({ kind: 'send-dm', userId: 'U0JONAS', text: 'hi' })
  })

  it('"message maya" with no text opens the DM', () => {
    expect(parseCommand('message Maya Chen', ctx)).toEqual({
      kind: 'open-dm',
      userId: mayaId,
      label: 'Message Maya Chen',
      sub: 'Opens your Main thread with Maya',
      confidence: 0.88,
      hint: '↵',
    })
  })

  it('prefers a full name over a first name and lowers confidence for an ambiguous first name', () => {
    expect(parseCommand('tell maya lindqvist hello', ctx)).toMatchObject({ userId: 'U0MAYA2', text: 'hello', confidence: 0.95 })
    expect(parseCommand('tell maya hello', ctx)).toMatchObject({ userId: mayaId, confidence: 0.75 })
    expect(parseCommand('tell jonas hello', ctx)).toMatchObject({ userId: 'U0JONAS', confidence: 0.95 })
  })

  it('does not treat unknown names as commands', () => {
    expect(parseCommand('tell nobody anything', ctx)).toBeUndefined()
    expect(parseCommand('tell', ctx)).toBeUndefined()
  })

  it('"post in #eng …" posts to a channel, never to a DM', () => {
    expect(parseCommand('post in #eng deploy is done', ctx)).toEqual({
      kind: 'post',
      channelId: eng.id,
      text: 'deploy is done',
      label: 'Post in #eng',
      sub: '"deploy is done"',
      confidence: 0.93,
      hint: '↵ Send',
    })
    expect(parseCommand('say to hiring the loop is set', ctx)).toMatchObject({ kind: 'post', channelId: hiring.id })
    expect(parseCommand('post in #nope hi', ctx)).toBeUndefined()
  })

  it('routes summaries and "what did I miss" to Juno', () => {
    expect(parseCommand('summarize #eng today', ctx)).toMatchObject({ kind: 'ask', prompt: 'summarize #eng today', label: 'Ask Juno to summarize #eng today', sub: 'Opens Juno with this request' })
    expect(parseCommand('what did I miss', ctx)).toMatchObject({ kind: 'ask', label: 'Ask Juno to catch you up' })
    expect(parseCommand('catch me up on hiring', ctx)).toMatchObject({ kind: 'ask', label: 'Ask Juno to catch you up on hiring' })
    expect(parseCommand('tl;dr', ctx)).toMatchObject({ kind: 'ask', label: 'Ask Juno to summarize' })
  })

  it('"resolve pricing" resolves the best-matching topic', () => {
    expect(parseCommand('resolve pricing', ctx)).toEqual({
      kind: 'resolve',
      topicId: ctx.topics[0]!.id,
      label: 'Resolve Pricing page copy',
      sub: '#product · hides it until there is new activity',
      confidence: 0.75,
      hint: '↵ Resolve',
    })
    expect(parseCommand('resolve staging bill', ctx)).toMatchObject({ topicId: ctx.topics[1]!.id, confidence: 0.9 })
    expect(parseCommand('resolve nothing here', ctx)).toBeUndefined()
  })

  it('treats short or plain queries as search', () => {
    expect(parseCommand('eng', ctx)).toBeUndefined()
    expect(parseCommand('staging bill', ctx)).toBeUndefined()
  })

  it('formats the confidence badge', () => {
    expect(confidenceLabel(0.95)).toBe('95%')
    expect(confidenceLabel(1.2)).toBe('100%')
  })
})
