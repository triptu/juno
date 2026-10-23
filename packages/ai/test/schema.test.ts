/** Task outputs: what the schema and the accept rule let through. */
import { describe, expect, it } from 'bun:test'
import { decisionTasks, tasks, validateOutput } from '../src/index'
import { channels, people, postgres, stagingBill } from './fixtures'

describe('output validation', () => {
  it('every structured task rejects arguments that are not an object', () => {
    for (const task of decisionTasks) {
      expect(validateOutput(task as never, {} as never, 'text').ok, task.name).toBe(false)
      expect(validateOutput(task as never, {} as never, null).ok, task.name).toBe(false)
    }
  })

  it('routeCheck accepts a known topic or null and rejects an unknown id or a confidence outside 0..1', () => {
    const input = { draft: 'x', channel: '#eng', topics: [stagingBill, postgres] }
    expect(validateOutput(tasks.routeCheck, input, { replyTo: stagingBill.id, confidence: 0.7 })).toEqual({ ok: true, value: { replyTo: stagingBill.id, confidence: 0.7 } })
    expect(validateOutput(tasks.routeCheck, input, { replyTo: null, confidence: 1 }).ok).toBe(true)
    expect(validateOutput(tasks.routeCheck, input, { replyTo: 't:C0ENG:9.000001', confidence: 0.7 }).ok).toBe(false)
    expect(validateOutput(tasks.routeCheck, input, { replyTo: null, confidence: 1.5 }).ok).toBe(false)
    expect(validateOutput(tasks.routeCheck, input, { confidence: 0.5 }).ok).toBe(false)
  })


  it('settledScore takes a score with or without a reason', () => {
    const input = { topicId: postgres.id, title: postgres.title, channel: '#eng', now: 'now', messages: [] }
    expect(validateOutput(tasks.settledScore, input, { score: 0.8, reason: 'closed with thanks' }).ok).toBe(true)
    expect(validateOutput(tasks.settledScore, input, { score: 0.8 }).ok).toBe(true)
    expect(validateOutput(tasks.settledScore, input, { reason: 'closed' }).ok).toBe(false)
  })

  it('automatedChannel takes a probability between 0 and 1', () => {
    const input = { channelId: 'C0CI', channel: '#ci', messages: [] }
    expect(validateOutput(tasks.automatedChannel, input, { probability: 0.9, reason: 'only an app posts' }).ok).toBe(true)
    expect(validateOutput(tasks.automatedChannel, input, { probability: 0.4 }).ok).toBe(true)
    expect(validateOutput(tasks.automatedChannel, input, { probability: 1.2 }).ok).toBe(false)
    expect(validateOutput(tasks.automatedChannel, input, { reason: 'bots' }).ok).toBe(false)
  })

  it('notificationReading accepts only an instruction from the input and a known option', () => {
    const input = { messageTs: '1', where: '#eng', kind: 'channel' as const, sender: 's', text: 't', mentionsMe: false, now: 'now', before: [],
      facts: { ownerWroteLast: false, ownerStartedThread: false, senderWroteSinceOwner: false, exchangesLast30Days: 0 }, instructions: [{ id: 'i1', direction: 'stay' as const, text: 'greetings' }] }
    expect(validateOutput(tasks.notificationReading, input, { needsYou: 'ask', probabilities: { ask: 0.9 }, instruction: null }).ok).toBe(true)
    expect(validateOutput(tasks.notificationReading, input, { needsYou: 'ask', probabilities: {}, instruction: { id: 'i1', confidence: 0.9 } }).ok).toBe(true)
    expect(validateOutput(tasks.notificationReading, input, { needsYou: 'ask', probabilities: {}, instruction: { id: 'i9', confidence: 0.9 } }).ok).toBe(false)
    expect(validateOutput(tasks.notificationReading, input, { needsYou: 'urgent', probabilities: {}, instruction: null }).ok).toBe(false)
  })

  it('parseCommand only accepts targets from the lists, and post only in a channel', () => {
    const input = { text: 'x', people, channels, topics: [{ id: postgres.id, title: postgres.title, channel: '#eng' }] }
    expect(validateOutput(tasks.parseCommand, input, { command: { kind: 'send_dm', userId: 'U0MAYA', text: 'hi' }, confidence: 0.9 }).ok).toBe(true)
    expect(validateOutput(tasks.parseCommand, input, { command: { kind: 'send_dm', userId: 'U0NOBODY', text: 'hi' }, confidence: 0.9 }).ok).toBe(false)
    expect(validateOutput(tasks.parseCommand, input, { command: { kind: 'send_dm', userId: 'U0MAYA', text: '' }, confidence: 0.9 }).ok).toBe(false)
    expect(validateOutput(tasks.parseCommand, input, { command: { kind: 'post', channelId: 'C0ENG', text: 'hi' }, confidence: 0.9 }).ok).toBe(true)
    expect(validateOutput(tasks.parseCommand, input, { command: { kind: 'post', channelId: 'D0MAYA', text: 'hi' }, confidence: 0.9 }).ok).toBe(false)
    expect(validateOutput(tasks.parseCommand, input, { command: { kind: 'resolve', topicId: postgres.id }, confidence: 0.9 }).ok).toBe(true)
    expect(validateOutput(tasks.parseCommand, input, { command: { kind: 'dance' }, confidence: 0.9 }).ok).toBe(false)
    expect(validateOutput(tasks.parseCommand, input, { command: null, confidence: 0.9 }).ok).toBe(true)
  })

})
