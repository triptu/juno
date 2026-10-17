import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { CardPayload, CardRecord, ChildEvidence, actionDigest, childOutcome, expandChildActions, toCard, transitionAttempt, transitionCard, transitionJob } from '@juno/agent-cards'
import { message, payloads } from './fixtures'

const outcomes = fc.constantFrom('pending', 'sending', 'sent', 'notSent', 'unknown')
const send = (texts: string[]) => Schema.decodeUnknownSync(CardPayload)({ _tag: 'sendMessage', messages: texts.map((text, i) => ({ ...message, id: `row-${i}`, actionId: `action-${i}`, text })) })
const evidenceFor = (child: ReturnType<typeof expandChildActions>[number], outcome: string) => Schema.decodeUnknownSync(ChildEvidence)({ id: child.id, rev: child.rev, digest: actionDigest(child.payload),
  attempts: outcome === 'pending' ? [] : [{ id: `${child.id}-attempt`, outcome: ({ sending: 'submitted', sent: 'done', notSent: 'failed', unknown: 'unknown' })[outcome] }],
})

describe('child actions and card status', () => {
  it('expands the exact ordered immutable batch and shows one result per row', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.string(), outcomes), { minLength: 1, maxLength: 5 }), (rows) => {
      const payload = send(rows.map(([text]) => text))
      const children = expandChildActions(payload)
      expect(children).toHaveLength(rows.length)
      const evidence = children.map((child, i) => evidenceFor(child, rows[i]?.[1] ?? 'pending'))
      children.forEach((child, i) => {
        expect(child.id).toBe(`action-${i}`)
        expect(child.payload.args).toEqual({ channelId: 'C_TEST', text: rows[i]?.[0] })
        expect(child.payload.tool).toBe('slack_send')
        expect(child.payload.destination_ids).toEqual(['C_TEST'])
        expect(child.payload.connection_id).toBe(message.connectionId)
        expect(child.payload.account_id).toBe(message.accountId)
        expect(child.payload.schema_hash).toBe(message.schemaHash)
        expect(child.payload.preconditions).toEqual(message.preconditions)
      })
      expect(expandChildActions(Schema.decodeUnknownSync(CardPayload)(JSON.parse(JSON.stringify(payload))))).toEqual(children)
      const record = Schema.decodeUnknownSync(CardRecord)({ id: 'card', payload, createdAt: 0, sourceValid: true,
        status: { _tag: 'working' }, children: evidence })
      const view = toCard(record, 1)
      if (view._tag !== 'sendMessage') throw new Error('Expected send card')
      // A rejection and an outcome Juno cannot confirm look the same on the card.
      const tags = rows.map(([, outcome]) => outcome === 'notSent' || outcome === 'unknown' ? 'failed' : outcome)
      const sent = tags.filter((tag) => tag === 'sent').length
      const expected = tags.includes('pending') || tags.includes('sending') ? 'working' : sent > 0 ? 'done' : 'failed'
      expect(view.status._tag).toBe(expected)
      expect(view.messages.map((m) => m.result._tag)).toEqual(tags)
    }))
  })

  it('preserves receipts and uncertainty under arbitrary events', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom('submit', 'receipt', 'reject', 'lost', 'negative', 'cancel', 'cancelled')), (events) => {
      let state: Parameters<typeof transitionAttempt>[0] = 'consumed'
      let receipt = false
      for (const event of events) {
        const prior = state
        state = transitionAttempt(state, event)
        receipt ||= event === 'receipt'
        if (receipt) expect(state).toBe('done')
        if (event === 'negative') expect(state).toBe(prior)
        if (!receipt && prior === 'submitted' && (event === 'cancel' || event === 'cancelled')) expect(state).toBe('unknown')
        if (prior === 'cancel-requested' && event === 'cancelled') expect(state).toBe('cancelled')
      }
      // attemptEvidence: a receipt for attempt 1 must not erase unknown attempt 2.
      const evidence = Schema.decodeUnknownSync(ChildEvidence)({ id: 'action', rev: 1, digest: '0'.repeat(64), attempts: [{ id: 'one', outcome: 'done' }, { id: 'two', outcome: state }] })
      expect(childOutcome(evidence)).toBe('sent')
      expect(evidence.attempts[1]?.outcome).toBe(state)
    }))
  })

  it('shows a send Juno cannot confirm as Failed, offers nothing to click, and turns Sent on later proof', () => {
    const payload = send(['one'])
    const [child] = expandChildActions(payload)
    if (child === undefined) throw new Error('Expected a child')
    const record = Schema.decodeUnknownSync(CardRecord)({ id: 'card', payload, createdAt: 0, sourceValid: true, status: { _tag: 'working' }, children: [evidenceFor(child, 'unknown')] })
    const view = toCard(record, 1)
    if (view._tag !== 'sendMessage') throw new Error('Expected send card')
    expect(view.messages.map((m) => m.result)).toEqual([{ _tag: 'failed' }])
    expect(view.status).toEqual({ _tag: 'failed', line: 'Failed' })
    // The card runs once: a click on a settled card changes nothing, so it can never send again.
    expect(transitionCard(view.status, { _tag: 'click' })).toEqual({ _tag: 'failed', line: 'Failed' })
    expect(transitionCard({ _tag: 'open' }, { _tag: 'click' })).toEqual({ _tag: 'working' })
    expect(transitionCard(view.status, { _tag: 'result', status: { _tag: 'done', line: 'Sent' } })).toEqual({ _tag: 'done', line: 'Sent' })
  })

  it('shows a job Juno cannot tell is running as failed, and running again on later proof', () => {
    const payload = payloads.find((p) => p._tag === 'task')
    if (payload === undefined) throw new Error('Expected a task payload')
    const record = Schema.decodeUnknownSync(CardRecord)({ id: 'card', payload, createdAt: 0, sourceValid: true, job: { phase: transitionJob('running', 'unknown') } })
    expect(toCard(record, 1)).toMatchObject({ _tag: 'task', phase: 'failed' })
    expect(transitionJob('unknown', 'progress')).toBe('running')
  })

  it('projects every kind and expires only unconsumed proposals', () => {
    fc.assert(fc.property(fc.constantFrom(...payloads), fc.integer({ min: 0, max: 1_000_000_000 }), (payload, now) => {
      const record = Schema.decodeUnknownSync(CardRecord)({ id: 'card', payload, createdAt: 0, sourceValid: true, ...(payload._tag === 'task' ? { job: { phase: 'running' } } : { status: { _tag: 'open' } }), ...(payload._tag === 'sendMessage' ? { children: [] } : {}) })
      const view = toCard(record, now)
      expect(view._tag).toBe(payload._tag)
      if (view._tag !== 'task' && view._tag !== 'unknown') expect(view.status._tag).toBe(payload._tag === 'topics' || now < 604800000 ? 'open' : 'expired')
      if (view._tag === 'change') expect(view.fields).toEqual([{ name: 'text', after: 'Example' }])
      if (view._tag === 'proposedSchedule') expect(view.prompt).toBe('Summarize #test since the last run.')
    }))
  })
})
