import { Schema } from 'effect'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Card, SendMessageCard, chatCopy, sendMessageStatus } from '@juno/agent-contract'

const text = fc.string()
const optional = <A>(value: fc.Arbitrary<A>) => fc.option(value, { nil: undefined })
const tint = fc.constantFrom('public', 'private', 'dm')
const topic = fc.record({ topicId: text, title: text, where: text, tint })
const target = fc.oneof(
  fc.record({ _tag: fc.constant('topic'), topicId: text }),
  fc.record({ _tag: fc.constant('chatMessage'), messageId: text }),
  fc.record({ _tag: fc.constant('message'), channelId: text, ts: text }),
  fc.record({ _tag: fc.constant('url'), url: fc.constantFrom('https://example.com/pull/1', 'http://localhost:3773/x', 'http://127.0.0.1/', 'http://[::1]:3773'), label: text }),
  fc.record({ _tag: fc.constant('page'), page: fc.constantFrom('scheduled', 'remembers', 'memory', 'activity', 'connections', 'settings', 'review') }),
)
const flag = optional(fc.constant(true))
const status = fc.oneof(
  fc.record({ _tag: fc.constant('open'), mayHaveHappened: flag }),
  fc.record({ _tag: fc.constantFrom('working', 'dismissed', 'expired') }),
  fc.record({ _tag: fc.constant('done'), line: text, undo: flag, open: optional(target) }),
  fc.record({ _tag: fc.constant('failed'), line: text }),
)
const base = { id: text, status, because: optional(text) }
const result = fc.oneof(
  fc.record({ _tag: fc.constantFrom('pending', 'sending', 'failed') }),
  fc.record({ _tag: fc.constant('sent'), open: target }),
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
    phase: fc.constantFrom('running', 'needsYou', 'lostSight', 'done', 'failed', 'stopping', 'stopped'),
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
} satisfies Record<Card['_tag'], fc.Arbitrary<unknown>>

// JSON omits absent optional keys, just as the wire does.
const wireCard = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('card wire formats', () => {
  for (const [kind, arbitrary] of Object.entries(cards)) {
    it(`round-trips ${kind} without changing the wire data`, () => {
      fc.assert(fc.property(arbitrary.map(wireCard), (input) => {
        const card = Schema.decodeUnknownSync(Card)(input)
        expect(Schema.encodeSync(Card)(card)).toEqual(input)
      }), { numRuns: 100 })
    })
  }
})

// WP12: add count-template cases here once chatCopy has Sent {n} and Sent {n} of {m}.
// Keep this check at the package boundary so the pure catalogue cannot drift.
describe('send status copy', () => {
  it('matches the fixed chat copy', () => {
    for (const [tag, line] of [
      ['sent', chatCopy.card.sendMessage.sent],
      ['failed', chatCopy.card.failed],
    ] as const) {
      const messages = Schema.decodeUnknownSync(SendMessageCard)({
        _tag: 'sendMessage', id: 'card', status: { _tag: 'open' },
        messages: [{ id: 'row', target: { channelId: 'C_TEST', name: 'test', kindLabel: 'Public channel', tint: 'public' }, text: '',
          result: { _tag: tag, open: { _tag: 'topic', topicId: 'topic' } } }],
      }).messages
      expect(sendMessageStatus(messages)).toMatchObject({ line })
    }
  })
})
