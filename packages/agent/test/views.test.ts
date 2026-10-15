import { expect, it } from 'vitest'
import { Schema } from 'effect'
import { AccountId } from '@juno/agent-cards'
import { HostChannelId, HostView, OpId } from '@juno/agent-contract'
import { reply } from '@juno/agent-testing'
import type { ViewHost } from '../src/view-tools/host'
import { fakeHost, say } from './turns-harness'

import { served, run } from './serve-harness'
const account = AccountId.make('test-owner')
let calls = 0
const call = (name: string, args: Record<string, unknown>) => reply({ type: 'toolCall', id: `view-call-${++calls}`, name, arguments: args as never })
function fakeViews() {
  const views = new Map<string, typeof HostView.Type>()
  let sequence = 0
  const host: ViewHost = {
    account: () => account,
    list: async () => [...views.values()],
    save: async (_, draft, existing) => {
      const id = existing ?? `view-${++sequence}`
      const before = views.get(id) ?? null
      const after = Schema.decodeUnknownSync(HostView)({ ...draft, id, position: before?.position ?? views.size })
      views.set(id, after)
      return { id, undo: { id, expected: after, restore: before } }
    },
    delete: async (_, id) => {
      const before = views.get(id) ?? null
      views.delete(id)
      return { id, undo: { id, expected: null, restore: before } }
    },
    undo: async (_, undo) => { if (undo.restore === null) views.delete(undo.id); else views.set(undo.id, undo.restore) },
  }
  return { host, views }
}
const channels = [{ id: HostChannelId.make('C_ALERTS'), name: 'alerts' }, { id: HostChannelId.make('C_BOT'), name: 'bot-alerts' }]

it.each([false, true])('creates the requested view with Undo; Slack read = %s', async (tainted) => {
  const local = fakeViews()
  const patterns: string[] = []
  const { h, client } = await served({ compaction: false, views: local.host, host: {
    ...fakeHost().host, channels: async (pattern) => { patterns.push(pattern); return channels },
  } })
  h.fake.script([
    call('slack_channels', { pattern: '*alerts*' }),
    ...(tainted ? [call('slack_history', { channel: 'C_ALERTS' })] : []),
    call('juno_views', { _tag: 'create', view: { name: 'Bots', channels: channels.map((c) => c.id), keepOutOfAll: false } }),
    reply(say(tainted ? 'Apply this view.' : 'Created the Bots view.')),
  ])
  const ended = await h.ended(h.send('make a Bots view with every alerts channel'))
  expect(ended.ending).toEqual({ _tag: 'complete' })
  expect(patterns).toEqual(['*alerts*'])
  const [card] = h.turns.actions.views()
  expect(card?.card._tag).toBe('change')
  if (tainted) {
    expect(local.views.size).toBe(0)
    expect(card?.card).toMatchObject({ status: { _tag: 'open' }, because: expect.any(String) })
    expect(h.turns.actions.approve('apply-view', card!.binding!.identity, card!.binding!.children)).toEqual({ _tag: 'accepted' })
    await h.turns.actions.idle()
  }
  expect([...local.views.values()]).toEqual([expect.objectContaining({ name: 'Bots', channels: ['C_ALERTS', 'C_BOT'], keepOutOfAll: false })])
  if (!tainted) expect(h.turns.actions.approve('no-second-apply', card!.binding!.identity, card!.binding!.children)).toEqual({ _tag: 'refused', reason: 'stale' })
  const [applied] = h.turns.actions.views()
  expect(applied?.card).toMatchObject({ status: { _tag: 'done', line: 'Applied', undo: true } })
  expect((await run(client['agent.cards.undo']({ opId: OpId.make('undo-view'), identity: applied!.binding!.identity })))._tag).toBe('Success')
  expect((await run(client['agent.cards.undo']({ opId: OpId.make('undo-view'), identity: applied!.binding!.identity })))._tag).toBe('Success')
  expect(local.views.size).toBe(0)
  expect(h.turns.actions.views()[0]?.card).toMatchObject({ status: { _tag: 'done', line: 'Undone' } })
  expect(h.reports).toEqual([])
})
