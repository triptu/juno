import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import * as C from '@juno/agent-contract'

const op = { opId: 'operation' }
const accepted = op
const identity = { cardId: 'card', revision: 1, digest: '0'.repeat(64) }
const child = { actionId: 'action', revision: 1, digest: '0'.repeat(64) }
const card = { _tag: 'unknown', id: 'card', kind: 'future' }
const window = { limit: 20 }
const executable = { connection_id: 'connection', account_id: 'account', destination_ids: ['channel'], tool: 'slack.send', schema_hash: '0'.repeat(64), args: { text: 'Example' }, preconditions: {}, ops: [] }
const dispatch = { actionId: 'action', authorizationId: 'authorization', attemptId: 'attempt', digest: '0'.repeat(64), payload: executable, mode: 'single-attempt' }
const unknown = { _tag: 'unknown', attemptId: 'attempt' }
const topic = { topicId: 'topic', title: 'Example', where: 'test', tint: 'public' }
const place = { channelId: 'channel', name: 'test', kindLabel: 'Public channel', tint: 'public' }
const messagePage = { messages: [], next: 'next' }
const view = { id: 'view', name: 'Bots', icon: 'robot', channels: ['channel'], keepOutOfAll: true, position: 0 }
const undo = { id: 'view', expected: view, restore: null }
const viewChange = { id: 'view', undo }
const cases: Record<string, readonly [unknown, unknown]> = {
  'agent.chat.page': [{ window: { _tag: 'around', anchor: '1', before: 5, limit: 20 } }, { page: { items: [], banner: { _tag: 'none' }, moreAbove: true, moreBelow: true, composerEnabled: true }, cards: [], messages: [] }],
  'agent.chat.summary': [null, { unread: 1, busy: false }],
  'agent.chat.send': [{ ...op, text: 'Example' }, accepted],
  'agent.chat.react': [{ ...op, target: { _tag: 'bubble', id: 'run:0' }, emoji: '🎉' }, accepted],
  'agent.chat.retry': [{ ...op, interruptedOpId: 'previous' }, accepted],
  'agent.chat.read': [{ through: '1' }, undefined],
  'agent.chat.remove': [{ ...op, messageId: '1', alsoRemoveReply: true }, accepted],
  'agent.cards.prepare': [{ ...op, identity, choice: { _tag: 'send' } }, { card, identity, children: [child] }],
  'agent.cards.approve': [{ ...op, identity, children: [child] }, accepted],
  'agent.cards.dismiss': [{ ...op, identity }, accepted],
  'agent.cards.askAgain': [{ ...op, identity }, accepted],
  'agent.cards.editMessage': [{ ...op, identity, messageId: 'message', text: 'Changed' }, { card, identity }],
  'agent.cards.undo': [{ ...op, identity }, accepted],
  'agent.jobs.stop': [{ ...op, jobId: 'job' }, accepted],
  'agent.schedule.watchReply': [{ ...op, channelId: 'C-test', ts: '100.000001' }, { ...accepted, id: 'watch', at: 1234 }],
  'agent.scheduled.page': [null, { page: { schedules: [] }, revisions: [] }],
  'agent.scheduled.edit': [{ ...op, id: 'schedule', revision: 1, what: 'Example', schedule: { _tag: 'once', at: 1234 }, deliver: 'digest' }, accepted],
  'agent.scheduled.action': [{ ...op, id: 'schedule', revision: 1, action: 'pause' }, accepted],
  'agent.remembers.page': [null, { page: { pins: [], usedBytes: 0, budgetBytes: 4096 }, revisions: [] }],
  'agent.remembers.edit': [{ ...op, id: 'pin', revision: 1, text: 'Example' }, accepted],
  'agent.remembers.remove': [{ ...op, id: 'pin', revision: 1 }, accepted],
  'agent.remembers.pin': [{ ...op, messageId: '1', revision: 1, startByte: 0, endByte: 1 }, accepted],
  'agent.memory.page': [{ window }, { lines: [] }],
  'agent.activity.page': [{ window }, { runs: [], moreAbove: false }],
  'agent.connections.page': [null, { connections: [] }],
  'agent.connections.action': [{ ...op, id: 'connection', action: 'connect' }, accepted],
  'agent.connections.tier': [{ ...op, id: 'connection', tool: 'read', schemaHash: '0'.repeat(64), tier: 0 }, accepted],
  'agent.connections.address': [{ ...op, address: { url: 'http://localhost:3773/mcp', allowNetwork: false } }, accepted],
  'agent.review.page': [null, { page: { backupAt: 1234, pending: [] }, cards: [] }],
  'agent.review.activate': [{ ...op, backupAt: 1234, oldDeviceOffOrErased: true }, accepted],
  'agent.settings.page': [null, { chatModels: [], compactionModels: [], spentTodayUsd: 0, capUsd: 2, codex: { _tag: 'missing' }, openRouterKey: 'missing', rules: [], paused: false, backupFolder: 'backup', ownership: { _tag: 'active', epoch: 1 } }],
  'agent.settings.change': [{ ...op, change: { _tag: 'cap', usd: 2 } }, accepted],
  'agent.settings.credentials': [{ provider: 'codex', action: 'setUp' }, undefined],
  'agent.settings.ownership': [{ ...op, action: { _tag: 'move' } }, accepted],
  'host.hello': [{ protocol: 2 }, { host: 'juno', protocol: 2 }],
  'host.slack.channels': [{ accountId: 'account', pattern: '*alerts*', cursor: 'channel', limit: 20 }, { channels: [{ id: 'channel', name: 'alerts' }], next: 'next' }],
  'host.views.list': [{ accountId: 'account' }, [view]],
  'host.views.create': [{ accountId: 'account', view }, viewChange],
  'host.views.update': [{ accountId: 'account', id: 'view', view }, { id: 'view', undo: { ...undo, restore: { ...view, name: 'Old' } } }],
  'host.views.delete': [{ accountId: 'account', id: 'view' }, { id: 'view', undo: { id: 'view', expected: null, restore: view } }],
  'host.views.undo': [{ accountId: 'account', undo }, undefined],
  'host.slack.search': [{ accountId: 'account', query: 'Example', limit: 20 }, messagePage],
  'host.slack.history': [{ accountId: 'account', channelId: 'channel', limit: 20 }, messagePage],
  'host.slack.replies': [{ accountId: 'account', channelId: 'channel', threadTs: '1.0', limit: 20 }, messagePage],
  'host.topics.list': [window, { topics: [topic], next: 'next' }],
  'host.topics.get': [{ topicId: 'topic' }, { topic, place, accountId: 'account', resolved: false, messages: messagePage }],
  'host.slack.person': [{ accountId: 'account', userId: 'person' }, { id: 'person', name: 'Example', displayName: 'Example' }],
  'host.outbox.send': [dispatch, unknown],
  'host.topics.resolve': [dispatch, unknown],
  'host.outbox.cancel': [{ authorizationId: 'authorization', attemptId: 'attempt' }, { _tag: 'cancel-requested' }],
  'host.outbox.reconcileSend': [{ accountId: 'account', channelId: 'channel', actionId: 'action', attemptId: 'attempt' }, { _tag: 'unknown' }],
  'host.schedule.check': [{ accountId: 'account', conversation: { channelId: 'C', ts: '100' }, refresh: true }, { owner: 'U', ownMessage: true, messages: [] }],
  'host.schedule.hours': [{ accountId: 'account' }, { timeZone: 'UTC', weekdays: [1], start: 540, end: 1020 }],
  'host.schedule.changes': [null, undefined],
  'host.presence': [null, { online: true, aiEnabled: true, quietHours: false, ownerActive: true, accountId: 'account', thisTopic: null }],
  'host.notification.deliver': [{ id: 'notification', title: 'Example', body: 'Example', deliver: 'digest' }, 'held'],
}

function roundTrip<S extends Schema.Codec<unknown, unknown>>(schema: S, value: unknown) {
  const codec = Schema.toCodecJson(schema)
  const decoded = Schema.decodeUnknownSync(codec)(value)
  const encoded = Schema.encodeSync(codec)(decoded)
  expect(Schema.decodeUnknownSync(codec)(JSON.parse(JSON.stringify(encoded)))).toEqual(decoded)
}

const groups = { ChatRpcs: C.ChatRpcs, CardRpcs: C.CardRpcs, ScheduledRpcs: C.ScheduledRpcs, RemembersRpcs: C.RemembersRpcs,
  MemoryRpcs: C.MemoryRpcs, ActivityRpcs: C.ActivityRpcs, ConnectionsRpcs: C.ConnectionsRpcs, ReviewRpcs: C.ReviewRpcs,
  SettingsRpcs: C.SettingsRpcs, HostHelloRpcs: C.HostHelloRpcs, HostReadRpcs: C.HostReadRpcs, HostViewRpcs: C.HostViewRpcs,
  HostActionRpcs: C.HostActionRpcs, HostPresenceRpcs: C.HostPresenceRpcs, HostScheduleRpcs: C.HostScheduleRpcs, HostNotificationRpcs: C.HostNotificationRpcs }

describe('RPC group wire round trips', () => {
  for (const [name, group] of Object.entries(groups)) it(name, () => {
    for (const route of group.requests.values()) {
      const sample = cases[route._tag]
      expect(sample, route._tag).toBeDefined()
      if (sample === undefined) throw new Error(`Missing example for ${route._tag}`)
      roundTrip(route.payloadSchema, sample[0])
      const schema = route.successSchema
      roundTrip('success' in schema ? schema.success : schema, sample[1] === undefined ? null : sample[1])
      const errorSchema = 'error' in schema ? schema.error : route.errorSchema
      const error = route._tag.startsWith('host.')
        ? new C.AgentHostError({ reason: 'offline', message: 'Offline' })
        : new C.AgentCommandError({ reason: 'stale', message: 'Changed' })
      if (Schema.is(errorSchema)(error)) roundTrip(errorSchema, Schema.encodeSync(errorSchema)(error))
    }
  })
})
