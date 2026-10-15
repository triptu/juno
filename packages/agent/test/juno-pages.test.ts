// Settings › Juno and the Juno menu's pages as the renderer reads them (SPEC 13.10, plan v3 §13.3),
// on the real turn engine with the scripted fake provider and the fake OpenRouter catalogue.
import { expect, it } from 'vitest'
import { Effect, Stream } from 'effect'
import { fakeActionHost, rejectedKey, reply, TEST_CHANNEL } from '@juno/agent-testing'
import { Revision } from '@juno/agent-cards'
import type { ChatItem, ChatPage, JunoSettingsPage, OpId, PinId, ScheduleId } from '@juno/agent-contract'
import { openRouterTurns } from '../src/index'
import { run, served } from './serve-harness'
import { say } from './turns-harness'

const of = <T extends ChatItem['_tag']>(page: ChatPage, tag: T) => page.items.filter((item): item is Extract<ChatItem, { _tag: T }> => item._tag === tag)
const first = <A, E>(stream: Stream.Stream<A, E>) => Effect.runPromise(Stream.runHead(stream)).then((head) => (head._tag === 'Some' ? head.value : undefined))
const selected = (page: JunoSettingsPage) => [page.chatModels.find((m) => m.selected)?.family, page.compactionModels.find((m) => m.selected)?.family]

it('lists one model row per family from the OpenRouter catalogue, with Sonnet and Haiku chosen by default', async () => {
  const { client, follow, catalogueReads } = await served()
  const page = await follow(client['agent.settings.page']()).where(() => true, 'a page')
  expect(page.chatModels).toEqual([
    { family: 'Claude Sonnet', resolved: 'Claude Sonnet 5.5', provider: 'openrouter', price: '$2 / $10 per million tokens', selected: true },
    { family: 'Claude Opus', resolved: 'Claude Opus 5.5', provider: 'openrouter', price: '$4 / $20 per million tokens', selected: false },
    { family: 'Muse', resolved: 'Muse Wonder', provider: 'openrouter', price: '$4 / $20 per million tokens', selected: false },
    { family: 'GPT Sol', resolved: 'GPT-6.1 Sol', provider: 'openrouter', price: '$2 / $10 per million tokens', selected: false },
    { family: 'Grok', resolved: 'Grok 4.7', provider: 'openrouter', price: '$2 / $6 per million tokens', selected: false },
  ])
  expect(page.compactionModels).toEqual([
    { family: 'Claude Haiku', resolved: 'Claude Haiku 5.5', provider: 'openrouter', price: '$0.10 / $0.50 per million tokens', selected: true },
    { family: 'Gemini Flash', resolved: 'Gemini 3.8 Flash', provider: 'openrouter', price: '$0.75 / $3.75 per million tokens', selected: false },
  ])
  expect(page).toMatchObject({ capUsd: 2, spentTodayUsd: 0, openRouterKey: 'missing', paused: false, rules: [], codex: { _tag: 'missing' }, ownership: { _tag: 'active', epoch: 1 } })
  expect(catalogueReads()).toBe(1)
})

it('a chosen chat model is used from the next run and kept for the next start', async () => {
  const { h, client, follow, pageWhere, key, picker } = await served()
  const settings = follow(client['agent.settings.page']())

  const chose = await run(client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'model', purpose: 'chat', provider: 'openrouter', family: 'Claude Opus' } }))
  expect(chose).toMatchObject({ _tag: 'Success', success: { opId: 'op-1' } })
  const changed = await settings.where((p) => selected(p)[0] === 'Claude Opus', 'Opus chosen')
  expect(selected(changed)).toEqual(['Claude Opus', 'Claude Haiku'])

  h.fake.script([reply(say('From Opus.'))])
  await run(client['agent.chat.send']({ opId: 'op-2' as OpId, text: 'hello' }))
  await pageWhere((p) => of(p, 'juno').length === 1 && of(p, 'status').length === 0, 'the answer')
  expect(h.chatRequests().map((r) => r.model)).toEqual(['anthropic/claude-opus-5.5'])

  // The next start reads the saved family.
  expect(openRouterTurns(key, picker).model(h.turns.store)).toEqual({ provider: 'openrouter', modelId: 'anthropic/claude-opus-5.5' })
})

it('a compaction model change applies to compaction, and an unknown family is refused', async () => {
  const { h, client, follow } = await served({ compaction: true })
  const settings = follow(client['agent.settings.page']())
  await run(client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'model', purpose: 'compaction', provider: 'openrouter', family: 'Gemini Flash' } }))
  await settings.where((p) => selected(p)[1] === 'Gemini Flash', 'Flash chosen')
  expect(h.turns.models().compaction).toEqual({ provider: 'openrouter', modelId: 'google/gemini-3.8-flash' })
  expect(h.turns.models().chat.modelId).toBe('anthropic/claude-sonnet-5.5')

  const unknown = await run(client['agent.settings.change']({ opId: 'op-2' as OpId, change: { _tag: 'model', purpose: 'chat', provider: 'openrouter', family: 'Claude Haiku' } }))
  expect(unknown).toMatchObject({ _tag: 'Failure', failure: { _tag: 'AgentCommandError', reason: 'invalid' } })
  const codex = await run(client['agent.settings.change']({ opId: 'op-3' as OpId, change: { _tag: 'model', purpose: 'chat', provider: 'codex', family: 'GPT Sol' } }))
  expect(codex).toMatchObject({ _tag: 'Failure', failure: { reason: 'unavailable' } })
})

it("shows today's spend from the ledger, and a new cap applies today but not below what today used", async () => {
  const { h, client, follow, pageWhere } = await served()
  const settings = follow(client['agent.settings.page']())
  // Sonnet in the fake costs $2 and $10 per million tokens: 10,000 in and 1,000 out is $0.03.
  h.fake.script([reply(say('Done.'), { usage: { input: 10_000, output: 1_000 } })])
  await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'hello' }))
  await pageWhere((p) => of(p, 'juno').length === 1 && of(p, 'status').length === 0, 'the answer')
  const spent = await settings.where((p) => p.spentTodayUsd > 0, 'spend recorded')
  expect(spent.spentTodayUsd).toBeCloseTo(0.03, 6)

  expect(await run(client['agent.settings.change']({ opId: 'op-2' as OpId, change: { _tag: 'cap', usd: 5 } }))).toMatchObject({ _tag: 'Success' })
  await settings.where((p) => p.capUsd === 5, 'the new cap')
  expect(h.turns.guard.spend.snapshot().cap).toBe(5_000_000_000)

  const below = await run(client['agent.settings.change']({ opId: 'op-3' as OpId, change: { _tag: 'cap', usd: 0.01 } }))
  expect(below).toMatchObject({ _tag: 'Failure', failure: { reason: 'invalid' } })
  expect((await first(client['agent.settings.page']()))?.capUsd).toBe(5)
})

it('Pause holds new messages until Resume', async () => {
  const { h, client, follow, pageWhere } = await served()
  const settings = follow(client['agent.settings.page']())
  await run(client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'paused', value: true } }))
  await settings.where((p) => p.paused, 'paused')
  h.fake.script([reply(say('Back.'))])
  await run(client['agent.chat.send']({ opId: 'op-2' as OpId, text: 'are you there?' }))
  const waiting = await pageWhere((p) => of(p, 'owner').length === 1, 'the waiting message')
  expect(waiting.banner).toEqual({ _tag: 'paused' })
  expect(of(waiting, 'owner')[0]).toMatchObject({ delivery: { _tag: 'waiting', for: 'resume' } })
  expect(h.chatRequests()).toEqual([])

  await run(client['agent.settings.change']({ opId: 'op-3' as OpId, change: { _tag: 'paused', value: false } }))
  await settings.where((p) => !p.paused, 'resumed')
  await pageWhere((p) => of(p, 'juno').length === 1, 'the answer after Resume')
})

it('shows whether the OpenRouter key is set, and when OpenRouter rejected it', async () => {
  const { h, client, follow, key } = await served()
  const settings = follow(client['agent.settings.page']())
  await settings.where((p) => p.openRouterKey === 'missing', 'no key')
  key.set('sk-or-v1-test')
  await settings.where((p) => p.openRouterKey === 'set', 'the key set')

  h.fake.script([rejectedKey()])
  await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'hello' }))
  await h.ended('op-1')
  await settings.where((p) => p.openRouterKey === 'rejected', 'the key rejected')

  key.set('sk-or-v1-other')
  await settings.where((p) => p.openRouterKey === 'set', 'a new key')
  key.set(null)
  await settings.where((p) => p.openRouterKey === 'missing', 'the key removed')
})

it('What Juno remembers lists a pinned message, and edits and removes it with a revision check', async () => {
  const { h, client, follow, pageWhere } = await served()
  h.fake.script([reply(say('Noted.'))])
  await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'I prefer short answers' }))
  await pageWhere((p) => of(p, 'juno').length === 1 && of(p, 'owner')[0]?.id !== undefined, 'the answer')
  const snapshot = await first(client['agent.chat.page']({ window: { _tag: 'latest', limit: 50 } }))
  const message = snapshot!.messages[0]!

  const remembers = follow(client['agent.remembers.page']())
  expect(await remembers.where((p) => p.page.pins.length === 0, 'no pins')).toMatchObject({ page: { usedBytes: 0, budgetBytes: 4096 }, revisions: [] })
  const pinned = await run(client['agent.remembers.pin']({ opId: 'op-2' as OpId, messageId: message.id, revision: message.revision, startByte: 2, endByte: 22 }))
  expect(pinned).toMatchObject({ _tag: 'Success' })
  const one = await remembers.where((p) => p.page.pins.length === 1, 'one pin')
  expect(one.page.pins[0]).toMatchObject({ text: 'prefer short answers', source: { messageId: message.id } })
  expect(one.page.usedBytes).toBe(20)
  const { id, revision } = one.revisions[0]!

  await run(client['agent.remembers.edit']({ opId: 'op-3' as OpId, id, revision, text: 'Short answers, please' }))
  const edited = await remembers.where((p) => p.page.pins[0]?.text === 'Short answers, please', 'the edit')
  expect(edited.page.pins[0]!.source).toBeUndefined()
  const stale = await run(client['agent.remembers.edit']({ opId: 'op-4' as OpId, id, revision, text: 'again' }))
  expect(stale).toMatchObject({ _tag: 'Failure', failure: { reason: 'stale' } })

  await run(client['agent.remembers.remove']({ opId: 'op-5' as OpId, id, revision: edited.revisions[0]!.revision }))
  await remembers.where((p) => p.page.pins.length === 0, 'the pin removed')
  expect(h.turns.pins.active().active).toEqual([])

  const changedMessage = await run(client['agent.remembers.pin']({ opId: 'op-6' as OpId, messageId: message.id, revision: Revision.make(message.revision + 1), startByte: 0, endByte: 1 }))
  expect(changedMessage).toMatchObject({ _tag: 'Failure', failure: { reason: 'stale' } })
})

it('Activity lists each finished run: who asked, when, and how it ended', async () => {
  const { h, client, follow } = await served()
  h.fake.script([reply(say('Here.')), reply('Nothing worth saying.'), rejectedKey()])
  for (const n of [1, 2, 3]) {
    h.send(`message ${n}`, { opId: `op-${n}` })
    await h.ended(`op-${n}`)
  }
  const activity = follow(client['agent.activity.page']({ window: { limit: 50 } }))
  const page = await activity.where((p) => p.runs.length === 3, 'three runs')
  expect(page.moreAbove).toBe(false)
  expect(page.runs.map((r) => [r.who, r.outcome, r.tainted, r.actions])).toEqual([
    ['You', 'replied', false, []],
    ['You', 'stayedQuiet', false, []],
    ['You', 'failed', false, []],
  ])

  const older = await first(client['agent.activity.page']({ window: { limit: 2, cursor: page.runs[2]!.id as never } }))
  expect(older?.runs.map((r) => r.outcome)).toEqual(['replied', 'stayedQuiet'])
  const newest = await first(client['agent.activity.page']({ window: { limit: 1 } }))
  expect(newest).toMatchObject({ runs: [{ outcome: 'failed' }], moreAbove: true })
})

it('Memory of this chat is a dated timeline of the published view', async () => {
  const { h, client, follow } = await served({ compaction: true })
  const memory = follow(client['agent.memory.page']({ window: { limit: 50 } }))
  expect(await memory.where(() => true, 'a page')).toEqual({ lines: [] })
  h.fake.script(Array.from({ length: 4 }, (_, n) => reply(say(`Answer ${n}.`))))
  for (let n = 0; n < 4; n++) {
    h.send(`question ${n}`, { opId: `op-${n}` })
    await h.ended(`op-${n}`)
  }
  await h.turns.compaction.idle()
  const page = await memory.where((p) => p.lines.length > 0, 'a summary line')
  // A short stretch is kept as its own words (a leaf copies its source); longer ones are summaries.
  const line = page.lines[0]!
  expect(line).toMatchObject({ _tag: 'line', text: expect.stringContaining('question 0') })
  expect(line.from).toBeLessThanOrEqual(line.to)
  expect(page.coveredThrough).toBeGreaterThanOrEqual(line.to)
})

it('Scheduled, Connections and Review are empty until their records exist, and their commands say so', async () => {
  const { client } = await served()
  expect(await first(client['agent.scheduled.page']())).toEqual({ page: { schedules: [] }, revisions: [] })
  expect(await first(client['agent.connections.page']())).toEqual({ connections: [] })
  expect(await first(client['agent.review.page']())).toEqual({ page: { pending: [] }, cards: [] })
  const pause = await run(client['agent.scheduled.action']({ opId: 'op-1' as OpId, id: 's1' as ScheduleId, revision: Revision.make(1), action: 'pause' }))
  expect(pause).toMatchObject({ _tag: 'Failure', failure: { reason: 'unavailable' } })
  const removed = await run(client['agent.remembers.remove']({ opId: 'op-3' as OpId, id: 'nope' as PinId, revision: Revision.make(1) }))
  expect(removed).toMatchObject({ _tag: 'Failure', failure: { reason: 'stale' } })
})

it('Rules: the owner sets them in Settings, the page lists them, and the next request carries them', async () => {
  const { h, client, follow } = await served()
  const settings = follow(client['agent.settings.page']())
  const rules = [{ id: 'r1', text: 'Ask before writing to #general.' }, { id: 'r2', text: 'Never message Sam on weekends.' }] as never as ReadonlyArray<{ id: never; text: string }>
  expect(await run(client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'rules', rules } }))).toMatchObject({ _tag: 'Success' })
  await settings.where((p) => p.rules.length === 2, 'two rules')
  expect((await settings.where((p) => p.rules.length === 2, 'two rules')).rules).toEqual(rules)
  const multiLine = await run(client['agent.settings.change']({ opId: 'op-2' as OpId, change: { _tag: 'rules', rules: [{ id: 'r3' as never, text: 'one\ntwo' }] } }))
  expect(multiLine).toMatchObject({ _tag: 'Failure', failure: { reason: 'invalid' } })

  h.fake.script([reply(say('Noted.'))])
  await run(client['agent.chat.send']({ opId: 'op-3' as OpId, text: 'hi' }))
  await h.ended('op-3')
  const system = JSON.stringify(h.chatRequests().at(-1)!.context)
  expect(system).toContain('- Ask before writing to #general.')
  expect(system).toContain('- Never message Sam on weekends.')
})

const send = (id: string) => reply({ type: 'toolCall', id, name: 'send_message', arguments: { messages: [{ topic: `m:${TEST_CHANNEL}`, text: `Text ${id}` }] } })

it('Activity lists each run\'s actions with the decision and outcome', async () => {
  const slack = fakeActionHost()
  const { h, client, follow } = await served({ actions: { host: slack.host } })
  h.fake.script([send('call-a'), send('call-b'), reply(say('Two drafts.'))])
  await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'draft two messages' }))
  await h.ended('op-1')
  const [kept, dropped] = h.turns.actions.views()
  slack.next('unknown')
  h.turns.actions.approve('click-1', kept!.binding!.identity, kept!.binding!.children)
  h.turns.actions.dismiss(dropped!.binding!.identity)
  await h.turns.actions.idle()
  const page = await follow(client['agent.activity.page']({ window: { limit: 50 } })).where((p) => p.runs[0]?.actions.length === 2, 'two actions')
  expect(page.runs[0]!.actions.map((a) => [a.label, a.tier, a.decision, a.outcome, a.failure?.text])).toEqual([
    ['Message to #test-0001', 3, 'approved', 'unknown', 'Juno could not confirm it went through.'],
    ['Message to #test-0001', 3, 'dismissed', 'none', undefined],
  ])
})
