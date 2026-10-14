import { Schema } from 'effect'
import { CardPayload, ExecutableIdentity } from '@juno/agent-cards'

export const identity = Schema.decodeUnknownSync(ExecutableIdentity)({
  connection_id: 'connection', account_id: 'account', destination_ids: ['C_TEST'],
  tool: 'test.write', schema_hash: '0'.repeat(64), args: { text: 'Example' },
  preconditions: { version: 1 }, ops: [{ write: true }],
})
export const action = { id: '019a0000-0000-7000-8000-000000000001', rev: 1, payload: identity, tier: 3, deduped: false, source: 0 }
export const topic = { topicId: 'm:C_TEST', title: 'Example', where: 'test', tint: 'public' }
export const place = { channelId: 'C_TEST', name: 'test', kindLabel: 'Public channel', tint: 'public' }
export const message = { id: 'message', actionId: action.id, rev: 1, source: 0, connectionId: 'connection', accountId: 'account',
  schemaHash: '0'.repeat(64), target: place, text: 'Example', preconditions: { version: 1 } }
export const payloads = [
  { _tag: 'sendMessage', messages: [message] },
  { _tag: 'resolve', action, topics: [topic] },
  { _tag: 'topics', links: [topic] },
  { _tag: 'proposedTask', action, kind: 't3', title: 'Example', where: 'test' },
  { _tag: 'task', jobId: 'job', kind: 't3', title: 'Example', where: 'test' },
  { _tag: 'question', action, asks: { _tag: 'juno' }, prompt: 'Example?', options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }], freeText: true },
  { _tag: 'proposedSchedule', action, what: 'Example', when: 'Tomorrow', deliver: 'digest', prompt: 'Summarize #test since the last run.' },
  { _tag: 'schedule', action, scheduleId: 'schedule', what: 'Example', when: 'Tomorrow', deliver: 'now' },
  { _tag: 'connect', action, server: 'Example', scopes: ['read'], leaves: 'Query text' },
  { _tag: 'change', action, server: 'Example', target: 'Example' },
  { _tag: 'remove', action, messages: [{ messageId: '1', preview: 'Example', at: 1 }] },
  { _tag: 'budget', action, spentTodayUsd: 2, capUsd: 2 },
  { _tag: 'provider', action, options: [{ id: 'codex', label: 'Codex', note: 'Local' }] },
].map((value) => Schema.decodeUnknownSync(CardPayload)(value))
