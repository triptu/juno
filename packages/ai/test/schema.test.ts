/** Task outputs: what the schema and the accept rule let through. */
import { describe, expect, it } from 'vitest'
import { decisionTasks, tasks, validateOutput } from '../src/index'
import { C, channels, people, postgres, stagingBill } from './fixtures'

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

  it('groupRun needs three distinct known ts values', () => {
    const input = { channelId: C('C0ENG'), channel: '#eng', messages: ['1', '2', '3'].map((ts) => ({ ts, sender: 's', text: 't', at: 'now' })) }
    expect(validateOutput(tasks.groupRun, input, { group: { messageTs: ['1', '2', '3'], title: 'A run' }, confidence: 0.8 }).ok).toBe(true)
    expect(validateOutput(tasks.groupRun, input, { group: { messageTs: ['1', '2'], title: 'A run' }, confidence: 0.8 }).ok).toBe(false)
    expect(validateOutput(tasks.groupRun, input, { group: { messageTs: ['1', '1', '2'], title: 'A run' }, confidence: 0.8 }).ok).toBe(false)
    expect(validateOutput(tasks.groupRun, input, { group: { messageTs: ['1', '2', '9'], title: 'A run' }, confidence: 0.8 }).ok).toBe(false)
    expect(validateOutput(tasks.groupRun, input, { group: null, confidence: 0.9 }).ok).toBe(true)
  })

  it('settledScore takes a score with or without a reason', () => {
    const input = { topicId: postgres.id, title: postgres.title, channel: '#eng', now: 'now', messages: [] }
    expect(validateOutput(tasks.settledScore, input, { score: 0.8, reason: 'closed with thanks' }).ok).toBe(true)
    expect(validateOutput(tasks.settledScore, input, { score: 0.8 }).ok).toBe(true)
    expect(validateOutput(tasks.settledScore, input, { reason: 'closed' }).ok).toBe(false)
  })

  it('urgencyGate takes two probabilities and nothing else', () => {
    const input = { messageTs: '1', channel: '#eng', channelKind: 'public' as const, sender: 's', text: 't', mentionsMe: false, now: 'now' }
    expect(validateOutput(tasks.urgencyGate, input, { urgent: 0.9, chatter: 0.1 }).ok).toBe(true)
    expect(validateOutput(tasks.urgencyGate, input, { urgent: 'high', chatter: 0.1 }).ok).toBe(false)
    expect(validateOutput(tasks.urgencyGate, input, { urgent: 0.9 }).ok).toBe(false)
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

  it('forYou allows an empty list, caps cards at 5, and rejects a card for an unknown topic', () => {
    const input = { me: 'Tushar', now: 'now', topics: [{ id: postgres.id, title: postgres.title, channel: '#eng', unread: 0, messages: [] }] }
    const card = { type: 'tidy_up', topicId: postgres.id, title: 'Done', body: 'Looks finished.' }
    expect(validateOutput(tasks.forYou, input, { cards: [] }).ok).toBe(true)
    expect(validateOutput(tasks.forYou, input, { cards: [card] }).ok).toBe(true)
    expect(validateOutput(tasks.forYou, input, { cards: Array.from({ length: 6 }, () => ({ ...card })) }).ok).toBe(false)
    expect(validateOutput(tasks.forYou, input, { cards: [{ ...card, topicId: 't:C0ENG:9.000001' }] }).ok).toBe(false)
    expect(validateOutput(tasks.forYou, input, { cards: [{ ...card, type: 'nag' }] }).ok).toBe(false)
  })
})
