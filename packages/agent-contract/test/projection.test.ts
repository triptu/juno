import { Schema } from 'effect'
import { expect, it } from 'vitest'
import fc from 'fast-check'
import { CardRecord, actionDigest, expandChildActions, SendMessagePayload } from '@juno/agent-cards'
import { Card, projectCard, sendMessageStatus } from '@juno/agent-contract'

it('projects child evidence into exactly the WP7 send view and derived status', () => {
  fc.assert(fc.property(fc.array(fc.tuple(fc.string(), fc.constantFrom('consumed', 'submitted', 'cancel-requested', 'cancelled', 'failed', 'unknown', 'done')), { minLength: 1, maxLength: 5 }), (rows) => {
    const payload = Schema.decodeUnknownSync(SendMessagePayload)({ _tag: 'sendMessage', messages: rows.map(([text], i) => ({
      id: `row-${i}`, actionId: `action-${i}`, rev: 1, source: 0, connectionId: 'connection', accountId: 'account', schemaHash: '0'.repeat(64),
      target: { channelId: 'C_TEST', name: 'test', kindLabel: 'Public channel', tint: 'public' }, text, preconditions: {},
    })) })
    const children = expandChildActions(payload).map((child, i) => ({ id: child.id, rev: child.rev, digest: actionDigest(child.payload),
      attempts: [{ id: `attempt-${i}`, outcome: rows[i]?.[1] }] }))
    const record = Schema.decodeUnknownSync(CardRecord)({ id: 'card', payload, createdAt: 0, sourceValid: true, status: { _tag: 'working' }, children })
    const view = projectCard(record, 1)
    expect(Schema.decodeUnknownSync(Card)(Schema.encodeSync(Card)(view))).toEqual(view)
    if (view._tag !== 'sendMessage') throw new Error('Expected send card')
    expect(view.status).toEqual(sendMessageStatus(view.messages))
  }))
})
