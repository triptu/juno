import { describe, expect, it } from 'bun:test'
import { UserId, parseCommand, threadTopicId, type CommandContext } from '../src/index'
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

/** The confidence of a parsed command. Fails the test when the text is not a command. */
function confidenceOf(text: string): number {
  const command = parseCommand(text, ctx)
  expect(command).toBeDefined()
  return command!.confidence
}

describe('⌘K commands', () => {
  // [typed, what it parses to; undefined when it is a search]
  it.each<[string, Record<string, unknown> | undefined]>([
    ['tell maya the wednesday slot works', { kind: 'send-dm', userId: mayaId, text: 'the wednesday slot works' }],
    // Other verbs; a leading "that" or "to" is dropped.
    ['message Jonas that the build is green', { kind: 'send-dm', userId: 'U0JONAS', text: 'the build is green' }],
    ['ping jonas to check staging', { kind: 'send-dm', text: 'check staging' }],
    ['dm Jonas Weber hi', { kind: 'send-dm', userId: 'U0JONAS', text: 'hi' }],
    // No text opens the DM.
    ['message Maya Chen', { kind: 'open-dm', userId: mayaId }],
    // A full name wins over a first name.
    ['tell maya lindqvist hello', { userId: 'U0MAYA2', text: 'hello' }],
    ['tell maya hello', { userId: mayaId }],
    ['tell nobody anything', undefined],
    ['tell', undefined],
    // Posts go to a channel, never to a DM.
    ['post in #eng deploy is done', { kind: 'post', channelId: eng.id, text: 'deploy is done' }],
    ['say to hiring the loop is set', { kind: 'post', channelId: hiring.id }],
    ['post in #nope hi', undefined],
    // Summaries and catching up go to Juno.
    ['summarize #eng today', { kind: 'ask', prompt: 'summarize #eng today' }],
    ['what did I miss', { kind: 'ask' }],
    ['catch me up on hiring', { kind: 'ask' }],
    ['tl;dr', { kind: 'ask' }],
    // Resolve takes the topic with the best word match.
    ['resolve pricing', { kind: 'resolve', topicId: ctx.topics[0]!.id }],
    ['resolve staging bill', { kind: 'resolve', topicId: ctx.topics[1]!.id }],
    ['resolve nothing here', undefined],
    // Short or plain queries are a search.
    ['eng', undefined],
    ['staging bill', undefined],
  ])('%j', (typed, expected) => {
    const command = parseCommand(typed, ctx)
    if (expected === undefined) expect(command).toBeUndefined()
    else expect(command).toMatchObject(expected)
  })

  it('is less certain of an ambiguous first name than of a full or unique name', () => {
    // Two people are called Maya.
    expect(confidenceOf('tell maya hello')).toBeLessThan(confidenceOf('tell maya lindqvist hello'))
    expect(confidenceOf('tell maya hello')).toBeLessThan(confidenceOf('tell jonas hello'))
    expect(confidenceOf('tell jonas hello')).toBe(confidenceOf('tell jonas weber hello'))
    expect(confidenceOf('tell maya the wednesday slot works')).toBeGreaterThan(0)
    expect(confidenceOf('tell maya the wednesday slot works')).toBeLessThanOrEqual(1)
  })

  it('is more certain of a resolve as more words match, and never above 1', () => {
    expect(confidenceOf('resolve staging bill')).toBeGreaterThan(confidenceOf('resolve staging'))
    expect(confidenceOf('resolve staging bill doubled since august')).toBeLessThanOrEqual(1)
  })
})
