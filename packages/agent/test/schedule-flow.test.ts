import { afterEach, expect, it } from 'bun:test'
import { Effect } from 'effect'
import { OpId } from '@juno/agent-contract'
import { fakeActionHost, reply, TEST_CHANNEL } from '@juno/agent-testing'
import { answer, turnsHarness } from './turns-harness'
import { served, closeServed } from './serve-harness'
import type { Executor } from '../src/actions/executor'
import { liveGrant } from '../src/grants/grants'
import { proposedScheduleCard, scheduleExecutors } from '../src/schedule/cards'
import type { Reply } from '../src/schedule/rules'
import { SCHEDULE_MIGRATIONS } from '../src/schedule/schema'
import { createScheduler } from '../src/schedule/scheduler'

afterEach(closeServed)

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

it('a proactive run cannot write to Slack: its send waits for the click, which sends it once', async () => {
  const { h, slack, advance } = await watching()
  h.fake.script([
    reply({ type: 'toolCall', id: 'nudge', name: 'send_message', arguments: { messages: [{ topic: `t:${TEST_CHANNEL}:100`, text: 'Any thoughts on this?' }] } }),
    reply({ type: 'text', text: '<say>Nobody has replied yet. Here is a draft.</say>' }),
  ])
  advance()
  await h.turns.checkSchedules()
  await h.ended(h.turns.scheduler.occurrences()[0]!.op_id)
  // Nothing the run did, and nothing after it, dispatches the card.
  h.turns.actions.kick()
  await h.turns.actions.idle()
  expect(slack.calls).toHaveLength(0)
  const send = h.turns.actions.views().find((v) => v.card._tag === 'sendMessage')!
  expect(h.turns.actions.approve('owner-click', send.binding!.identity, send.binding!.children)).toEqual({ _tag: 'accepted' })
  await h.turns.actions.idle()
  expect(slack.calls.map((call) => call.rpc)).toEqual(['send'])
  expect(slack.calls[0]!.dispatch.payload.args).toMatchObject({ channelId: TEST_CHANNEL, text: 'Any thoughts on this?' })
  // The same click again is the same click, and a new click on the clicked card is refused: nothing more is sent.
  h.turns.actions.approve('owner-click', send.binding!.identity, send.binding!.children)
  expect(h.turns.actions.approve('second-click', send.binding!.identity, send.binding!.children)._tag).not.toBe('accepted')
  await h.turns.actions.idle()
  expect(slack.calls).toHaveLength(1)
})

it('a Proposed schedule Start mints the grant and posts a Schedule card through the real action dispatcher', async () => {
  // The executors need the scheduler, which needs the engine's store: proxies stand in until it opens.
  let installed: ReadonlyArray<Executor> = []
  const proxies: ReadonlyArray<Executor> = ['schedule_create', 'schedule_action'].map((tool) => ({
    tool, tier: 1, deduped: true, run: async (call) => {
      const executor = installed.find((e) => e.tool === tool)
      if (executor === undefined) throw new Error('Executor not installed')
      return executor.run(call)
    },
  }))
  const h = await turnsHarness({ compaction: false, migrations: [SCHEDULE_MIGRATIONS], actions: { executors: proxies } })
  try {
    const scheduler = createScheduler({ store: h.turns.store, changed: () => {}, replies: async () => ({ owner: 'owner', messages: [] }) })
    installed = scheduleExecutors({ store: h.turns.store, scheduler, propose: h.turns.actions.propose })
    h.turns.actions.propose({ runId: 'test-run', callId: 'test-call', payload: proposedScheduleCard(h.turns.store, {
      what: 'Catch up tomorrow', prompt: 'Read the topic.', deliver: 'now', schedule: { _tag: 'once', at: h.turns.store.now() + 60_000 },
    }) })
    expect(scheduler.list()).toHaveLength(0)
    const binding = h.turns.actions.views()[0]?.binding
    if (binding === undefined) throw new Error('Missing proposal binding')
    expect(h.turns.actions.approve('start-schedule', binding.identity, binding.children)).toEqual({ _tag: 'accepted' })
    await h.turns.actions.idle()
    const row = scheduler.list()[0]
    expect(row?.definition.prompt).toBe('Read the topic.')
    expect(liveGrant(h.turns.store, 'schedule', row!.id)?.authority).toBe('click')
    expect(h.turns.actions.views().map((v) => v.card._tag)).toEqual(['proposedSchedule', 'schedule'])
    expect(h.fake.requests).toHaveLength(0)
  } finally { await h.close() }
})
