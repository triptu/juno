import { Schema, SchemaRepresentation } from 'effect'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Card as ProjectedCard, sendMessageStatus as projectedSendMessageStatus } from '@juno/agent-cards'
import { Card, SendMessageCard, chatCopy, sendMessageStatus } from '@juno/agent-contract'

const text = fc.string()
const optional = <A>(value: fc.Arbitrary<A>) => fc.option(value, { nil: undefined })
const tint = fc.constantFrom('public', 'private', 'dm')
const topic = fc.record({ topicId: text, title: text, where: text, tint })
const target = fc.oneof(
  fc.record({ _tag: fc.constant('topic'), topicId: text }),
  fc.record({ _tag: fc.constant('chatMessage'), messageId: text }),
  fc.record({ _tag: fc.constant('url'), url: fc.constantFrom('https://example.com/pull/1', 'http://localhost:3773/x', 'http://127.0.0.1/', 'http://[::1]:3773'), label: text }),
  fc.record({ _tag: fc.constant('page'), page: fc.constantFrom('scheduled', 'remembers', 'memory', 'activity', 'connections', 'settings', 'review') }),
)
const flag = optional(fc.constant(true))
const status = fc.oneof(
  fc.record({ _tag: fc.constant('open'), mayHaveHappened: flag }),
  fc.record({ _tag: fc.constantFrom('working', 'dismissed', 'expired') }),
  fc.record({ _tag: fc.constant('done'), line: text, undo: flag, open: optional(target) }),
  fc.record({ _tag: fc.constant('failed'), line: text, retry: flag, mayDuplicate: flag }),
  fc.record({ _tag: fc.constant('unknown'), line: text, check: optional(target), mayDuplicate: flag }),
)
const base = { id: text, status, because: optional(text) }
const result = fc.oneof(
  fc.record({ _tag: fc.constantFrom('pending', 'sending', 'notSent') }),
  fc.record({ _tag: fc.constant('sent'), open: target }),
  fc.record({ _tag: fc.constant('unknown'), check: target }),
)
const message = fc.record({
  id: text,
  target: fc.record({ channelId: text, name: text, kindLabel: text, tint }),
  inTopic: optional(topic), text, result,
})
const jobKind = fc.constantFrom('t3', 'subagent')
const schedule = { what: text, when: text, deliver: fc.constantFrom('now', 'digest', 'silent') }
const cards = {
  sendMessage: fc.record({ ...base, _tag: fc.constant('sendMessage'), messages: fc.array(message, { minLength: 1, maxLength: 5 }) }),
  resolve: fc.record({ ...base, _tag: fc.constant('resolve'), topics: fc.array(topic, { minLength: 1 }) }),
  topics: fc.record({ ...base, _tag: fc.constant('topics'), links: fc.array(topic, { minLength: 1 }) }),
  proposedTask: fc.record({ ...base, _tag: fc.constant('proposedTask'), kind: jobKind, title: text, where: text }),
  task: fc.record({
    id: text, because: optional(text), _tag: fc.constant('task'), jobId: text, kind: jobKind, title: text, where: text,
    phase: fc.constantFrom('running', 'needsYou', 'quiet', 'lostSight', 'done', 'failed', 'stopping', 'stopped', 'unknown'),
    state: optional(text), open: optional(target),
  }),
  question: fc.record({
    ...base, _tag: fc.constant('question'),
    asks: fc.oneof(fc.constant({ _tag: 'juno' }), fc.record({ _tag: fc.constant('t3'), job: fc.record({ jobId: text, title: text }) })),
    prompt: text, options: fc.array(fc.record({ id: text, label: text }), { minLength: 2, maxLength: 4 }), freeText: fc.boolean(),
  }),
  proposedSchedule: fc.record({ ...base, ...schedule, _tag: fc.constant('proposedSchedule'), prompt: text }),
  schedule: fc.record({ ...base, ...schedule, _tag: fc.constant('schedule'), scheduleId: text }),
  connect: fc.record({ ...base, _tag: fc.constant('connect'), server: text, scopes: fc.array(text), leaves: text }),
  change: fc.record({
    ...base, _tag: fc.constant('change'), server: text, target: text, caption: optional(text),
    fields: fc.array(fc.record({ name: text, before: optional(text), after: text, long: flag }), { minLength: 1 }),
  }),
  remove: fc.record({
    ...base, _tag: fc.constant('remove'), offerReply: optional(text),
    messages: fc.array(fc.record({ messageId: text, preview: text, at: fc.double({ noNaN: true, noDefaultInfinity: true }) }), { minLength: 1 }),
  }),
  budget: fc.record({ ...base, _tag: fc.constant('budget'), spentTodayUsd: fc.double({ noNaN: true, noDefaultInfinity: true }), capUsd: fc.double({ noNaN: true, noDefaultInfinity: true }) }),
  provider: fc.record({ ...base, _tag: fc.constant('provider'), options: fc.array(fc.record({ id: fc.constantFrom('openrouter', 'codex'), label: text, note: text })) }),
  unknown: fc.record({ _tag: fc.constant('unknown'), id: text, kind: text }),
} satisfies Record<Card['_tag'] | ProjectedCard['_tag'], fc.Arbitrary<unknown>>

// JSON omits absent optional keys, just as the wire does.
const wireCard = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

// Custom URL predicates are opaque functions; the property below checks their behaviour.
const shape = (schema: Schema.Top): unknown => JSON.parse(JSON.stringify(
  SchemaRepresentation.toRepresentation(schema.ast),
  (_key, value: unknown) => typeof value === 'function' ? '[predicate]' : value,
))

describe('card schema parity', () => {
  it('has the same encoded AST shape, including nested fields and constraints', () => {
    expect(shape(ProjectedCard)).toEqual(shape(Card))
  })

  it('agrees on URL validation inside nested card targets', () => {
    const urls = fc.oneof(text, fc.tuple(
      fc.constantFrom('https://', 'http://', 'file://', 'javascript:', ''),
      fc.constantFrom('localhost', 'localhost.evil.com', '127.0.0.1', '[::1]', 'example.com', ''),
      text,
    ).map((parts) => parts.join('')))
    fc.assert(fc.property(urls, (url) => {
      const input = { _tag: 'task', id: 'card', jobId: 'job', kind: 't3', title: '', where: '', phase: 'done', open: { _tag: 'url', url, label: '' } }
      expect(Schema.is(ProjectedCard)(input)).toBe(Schema.is(Card)(input))
    }), { numRuns: 500 })
  })

  for (const [kind, arbitrary] of Object.entries(cards)) {
    it(`encodes ${kind} identically in both directions`, () => {
      fc.assert(fc.property(arbitrary.map(wireCard), (input) => {
        const projected = Schema.decodeUnknownSync(ProjectedCard)(input)
        const chat = Schema.decodeUnknownSync(Card)(input)
        const projectedWire = Schema.encodeSync(ProjectedCard)(projected)
        const chatWire = Schema.encodeSync(Card)(chat)
        expect(projectedWire).toEqual(input)
        expect(chatWire).toEqual(input)
        expect(projectedWire).toEqual(chatWire)
        expect(Schema.encodeSync(Card)(Schema.decodeUnknownSync(Card)(projectedWire))).toEqual(projectedWire)
        expect(Schema.encodeSync(ProjectedCard)(Schema.decodeUnknownSync(ProjectedCard)(chatWire))).toEqual(chatWire)
      }), { numRuns: 100 })
    })
  }
})

// WP12: add count-template cases here once chatCopy has Sent {n} and Sent {n} of {m}.
// Keep this check at the package boundary so the pure catalogue cannot drift.
describe('send status copy', () => {
  it('matches the fixed chat copy in both status derivations', () => {
    for (const [tag, line] of [
      ['sent', chatCopy.card.sendMessage.sent],
      ['notSent', chatCopy.card.sendMessage.notSent],
      ['unknown', chatCopy.card.sendMessage.unknown],
    ] as const) {
      const messages = Schema.decodeUnknownSync(SendMessageCard)({
        _tag: 'sendMessage', id: 'card', status: { _tag: 'open' },
        messages: [{ id: 'row', target: { channelId: 'C_TEST', name: 'test', kindLabel: 'Public channel', tint: 'public' }, text: '',
          result: { _tag: tag, open: { _tag: 'topic', topicId: 'topic' }, check: { _tag: 'topic', topicId: 'topic' } } }],
      }).messages
      for (const derive of [projectedSendMessageStatus, sendMessageStatus]) {
        expect(derive(messages)).toMatchObject({ line })
      }
    }
  })
})
