import { expect, it } from 'vitest'
import { Effect } from 'effect'
import { OpId } from '@juno/agent-contract'
import { fakeActionHost, reply, TEST_CHANNEL } from '@juno/agent-testing'
import { answer } from './turns-harness'
import { served } from './serve-harness'
import type { Reply } from '../src/schedule/rules'

async function watching() {
  let now = Date.UTC(2026, 9, 19, 10)
  const messages: Reply[] = []
  let refreshes = 0
  const slack = fakeActionHost()
  const { h, client } = await served({
    now: () => now,
    actions: { host: slack.host },
    schedule: {
      replies: async () => { refreshes++; return { owner: 'owner', messages: [...messages] } },
      cachedReplies: async () => ({ owner: 'owner', messages: [...messages] }),
    },
    watchHost: { ownMessage: async () => true, hours: async () => ({ timeZone: 'UTC', weekdays: [1, 2, 3, 4, 5], start: 540, end: 1020 }) },
  })
  const watch = await Effect.runPromise(client['agent.schedule.watchReply']({ opId: OpId.make('watch'), channelId: TEST_CHANNEL, ts: '100', threadTs: '100' }))
  expect(h.fake.requests).toHaveLength(0)
  expect(h.turns.actions.views().map((v) => v.card._tag)).toEqual(['schedule'])
  return { h, watch, slack, messages, refreshes: () => refreshes, advance: () => { now = watch.at } }
}

it('a menu watch wakes once on the test clock, drafts a Send card, and a reply expires it', async () => {
  const { h, watch, slack, messages, refreshes, advance } = await watching()
  h.fake.script([
    reply({ type: 'toolCall', id: 'nudge', name: 'send_message', arguments: { messages: [{ topic: `t:${TEST_CHANNEL}:100`, text: 'Any thoughts on this?' }] } }),
    reply({ type: 'text', text: '<say>Nobody has replied yet. Here is a draft.</say>' }),
  ])
  advance()
  await h.turns.checkSchedules()
  const occurrence = h.turns.scheduler.occurrences()[0]!
  await h.ended(occurrence.op_id)
  expect(refreshes()).toBe(1)
  const send = h.turns.actions.views().find((v) => v.card._tag === 'sendMessage')!
  expect(send.card).toMatchObject({ status: { _tag: 'open' }, messages: [{ text: 'Any thoughts on this?' }] })
  expect(slack.calls).toHaveLength(0)
  expect(h.turns.scheduler.get(watch.id)?.state).toBe('deleted')
  const requests = h.fake.requests.length
  await h.turns.checkSchedules()
  expect(h.fake.requests).toHaveLength(requests)
  messages.push({ channelId: TEST_CHANNEL, ts: '101', threadTs: '100', userId: 'other' })
  await h.turns.checkSchedules()
  expect(h.turns.actions.views().find((v) => v.card._tag === 'sendMessage')?.card).toMatchObject({ status: { _tag: 'expired' } })
  expect(h.turns.actions.approve('stale-send', send.binding!.identity, send.binding!.children)).toEqual({ _tag: 'refused', reason: 'expired' })
  expect(h.fake.requests).toHaveLength(requests)
  expect(slack.calls).toHaveLength(0)
})

it('a reply before the deadline cancels the watch without a model run', async () => {
  const { h, watch, messages, advance, refreshes } = await watching()
  messages.push({ channelId: TEST_CHANNEL, ts: '101', threadTs: '100', userId: 'other' })
  await h.turns.checkSchedules()
  expect(h.turns.scheduler.get(watch.id)?.state).toBe('deleted')
  advance()
  await h.turns.checkSchedules()
  await h.turns.idle()
  expect(h.fake.requests).toHaveLength(0)
  expect(refreshes()).toBe(0)
  expect(h.turns.actions.views().some((v) => v.card._tag === 'sendMessage')).toBe(false)
})

it('expires a nudge proposed after the reply arrived during its model run', async () => {
  const { h, messages, advance } = await watching()
  let release!: () => void
  let entered!: () => void
  const waiting = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  h.fake.script([
    reply(async () => {
      entered()
      await gate
      return answer('<say>I will prepare a draft.</say>')
    }),
    reply({ type: 'toolCall', id: 'late-nudge', name: 'send_message', arguments: { messages: [{ topic: `t:${TEST_CHANNEL}:100`, text: 'Any thoughts?' }] } }),
    reply('<say>A reply arrived.</say>'),
  ])
  advance()
  await h.turns.checkSchedules()
  await waiting
  messages.push({ channelId: TEST_CHANNEL, ts: '101', threadTs: '100', userId: 'other' })
  await h.turns.checkSchedules()
  h.send('Prepare the draft for review.')
  release()
  await h.ended(h.turns.scheduler.occurrences()[0]!.op_id)
  expect(h.turns.actions.views().find((v) => v.card._tag === 'sendMessage')?.card).toMatchObject({ status: { _tag: 'expired' } })
})

it('starts a due occurrence once when it steers an active owner run', async () => {
  const { h, advance } = await watching()
  let release!: () => void
  let entered!: () => void
  const waiting = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  h.fake.script([
    reply(async () => { entered(); await gate; return answer('<say>Here is the answer.</say>') }),
    reply({ type: 'toolCall', id: 'steered-nudge', name: 'send_message', arguments: { messages: [{ topic: `t:${TEST_CHANNEL}:100`, text: 'Any thoughts?' }] } }),
    reply('<say>There is also a nudge to review.</say>'),
  ])
  const ownerOp = h.send('Help me plan today.')
  await waiting
  advance()
  await h.turns.checkSchedules()
  release()
  await h.ended(ownerOp)
  const occurrence = h.turns.scheduler.occurrences()[0]!
  expect(occurrence.state).toBe('started')
  expect(h.events.filter((event) => event._tag === 'started')).toHaveLength(1)
  expect(h.events.some((event) => event._tag === 'steered' && event.opId === occurrence.op_id)).toBe(true)
  expect(h.turns.actions.views().find((v) => v.card._tag === 'sendMessage')?.card).toMatchObject({ status: { _tag: 'open' } })
})
