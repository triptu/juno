// Settings › Juno, the Juno menu's pages and the message menu as the renderer reads them (SPEC 13.10,
// plan v3 §13.3): RPCs over a port to the real turn engine, with the scripted fake provider and the fake
// OpenRouter catalogue. The clock is the test's, so "today" never crosses a midnight.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { fakeActionHost, rejectedKey, reply, TEST_CHANNEL } from '@juno/agent-testing'
import { Revision } from '@juno/agent-cards'
import { OpId, type ChatItem, type ChatPage, type JunoSettingsPage } from '@juno/agent-contract'
import { providerTurns } from '../src/index'
import { fallbackSlug } from '../src/settings/store'
import { fakeKeychain } from './fixtures/keychain'
import { closeServed, run, served } from './serve-harness'
import { say } from './turns-harness'

afterEach(closeServed)
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-settings-'))
  dirs.push(dir)
  return dir
}

/** Noon, local time: a day's spend stays in that day. */
const NOON = new Date(2026, 9, 14, 12).getTime()

const of = <T extends ChatItem['_tag']>(page: ChatPage, tag: T) => page.items.filter((item): item is Extract<ChatItem, { _tag: T }> => item._tag === tag)
const selected = (page: JunoSettingsPage) => ({
  chat: page.chatModels.find((m) => m.selected)?.family,
  compaction: page.compactionModels.find((m) => m.selected)?.family,
  fallback: page.fallbackModels?.find((m) => m.selected)?.family,
})
const answered = (page: ChatPage) => of(page, 'juno').length > 0 && of(page, 'status').length === 0
const change = (opId: string, value: Parameters<Awaited<ReturnType<typeof served>>['client']['agent.settings.change']>[0]['change']) =>
  ({ opId: OpId.make(opId), change: value })

it('a chosen chat model is used from the next run and kept for the next start', async () => {
  const { h, client, follow, pageWhere, connection, picker } = await served({ now: () => NOON })
  const settings = follow(client['agent.settings.page']())
  expect(selected(await settings.where(() => true, 'a page')).chat).toBe('Claude Sonnet')

  const chose = await run(client['agent.settings.change'](change('op-1', { _tag: 'model', purpose: 'chat', provider: 'openrouter', family: 'Claude Opus' })))
  expect(chose).toMatchObject({ _tag: 'Success', success: { opId: 'op-1' } })
  await settings.where((p) => selected(p).chat === 'Claude Opus', 'Opus chosen')

  h.fake.script([reply(say('From Opus.'))])
  await run(client['agent.chat.send']({ opId: OpId.make('op-2'), text: 'hello' }))
  await pageWhere(answered, 'the answer')
  expect(h.chatRequests().map((r) => r.model)).toEqual(['anthropic/claude-opus-5.5'])

  // The next start reads the saved family.
  expect(providerTurns(connection, picker).model(h.turns.store)).toEqual({ provider: 'openrouter', modelId: 'anthropic/claude-opus-5.5' })
})

it('the compaction and fallback choices apply to the engine, and an unknown family or Codex is refused', async () => {
  const { h, client, follow, picker } = await served({ compaction: true, now: () => NOON })
  const settings = follow(client['agent.settings.page']())
  const page = await settings.where(() => true, 'a page')
  expect(selected(page)).toMatchObject({ compaction: 'Claude Haiku', fallback: 'Gemini Flash' })
  expect(fallbackSlug(h.turns.store, picker)).toBe('google/gemini-3.8-flash')

  await run(client['agent.settings.change'](change('op-1', { _tag: 'model', purpose: 'compaction', provider: 'openrouter', family: 'Gemini Flash' })))
  await settings.where((p) => selected(p).compaction === 'Gemini Flash', 'Flash chosen')
  expect(h.turns.models().compaction).toEqual({ provider: 'openrouter', modelId: 'google/gemini-3.8-flash' })
  expect(h.turns.models().chat.modelId).toBe('anthropic/claude-sonnet-5.5')

  // The engine's AI jobs hear the fallback's slug, or none.
  await run(client['agent.settings.change'](change('op-2', { _tag: 'model', purpose: 'fallback', provider: 'openrouter', family: 'GPT Sol' })))
  await settings.where((p) => selected(p).fallback === 'GPT Sol', 'GPT Sol chosen')
  expect(fallbackSlug(h.turns.store, picker)).toBe('openai/gpt-6.1-sol')
  await run(client['agent.settings.change'](change('op-3', { _tag: 'model', purpose: 'fallback', provider: 'openrouter', family: '' })))
  await settings.where((p) => selected(p).fallback === undefined, 'no fallback')
  expect(fallbackSlug(h.turns.store, picker)).toBe('')

  // A compaction family is not a chat family, and Codex is not signed in.
  const unknown = await run(client['agent.settings.change'](change('op-4', { _tag: 'model', purpose: 'chat', provider: 'openrouter', family: 'Claude Haiku' })))
  expect(unknown).toMatchObject({ _tag: 'Failure', failure: { _tag: 'AgentCommandError', reason: 'invalid' } })
  const codex = await run(client['agent.settings.change'](change('op-5', { _tag: 'model', purpose: 'chat', provider: 'codex', family: 'GPT Sol' })))
  expect(codex).toMatchObject({ _tag: 'Failure', failure: { reason: 'unavailable' } })
})

it("shows today's spend, and a cap below it stops the next message before it reaches the model", async () => {
  const { h, client, follow, pageWhere } = await served({ now: () => NOON })
  const settings = follow(client['agent.settings.page']())
  expect(await settings.where(() => true, 'a page')).toMatchObject({ capUsd: 2, spentTodayUsd: 0 })
  // Sonnet in the fake costs $2 and $10 per million tokens: 10,000 in and 1,000 out is $0.03.
  h.fake.script([reply(say('Done.'), { usage: { input: 10_000, output: 1_000 } })])
  await run(client['agent.chat.send']({ opId: OpId.make('op-1'), text: 'hello' }))
  await pageWhere(answered, 'the answer')
  const spent = await settings.where((p) => p.spentTodayUsd > 0, 'spend recorded')
  expect(spent.spentTodayUsd).toBeCloseTo(0.03, 6)

  expect(await run(client['agent.settings.change'](change('op-2', { _tag: 'cap', usd: 0.01 })))).toMatchObject({ _tag: 'Success' })
  const lowered = await settings.where((p) => p.capUsd === 0.01, 'the lower cap')
  expect(lowered.spentTodayUsd).toBeCloseTo(0.03, 6)

  h.fake.script([reply(say('Over the cap.'))])
  await run(client['agent.chat.send']({ opId: OpId.make('op-3'), text: 'one more' }))
  await h.ended('op-3')
  expect(h.chatRequests()).toHaveLength(1)
})

it('Pause shows in the banner at once and holds new messages until Resume', async () => {
  const { h, client, follow, pageWhere } = await served({ now: () => NOON })
  const settings = follow(client['agent.settings.page']())
  await pageWhere((p) => p.banner._tag === 'none', 'the chat')
  await run(client['agent.settings.change'](change('op-1', { _tag: 'paused', value: true })))
  await settings.where((p) => p.paused, 'paused')
  await pageWhere((p) => p.banner._tag === 'paused', 'the paused banner')

  h.fake.script([reply(say('Back.'))])
  await run(client['agent.chat.send']({ opId: OpId.make('op-2'), text: 'are you there?' }))
  const waiting = await pageWhere((p) => of(p, 'owner').length === 1, 'the waiting message')
  expect(of(waiting, 'owner')[0]).toMatchObject({ delivery: { _tag: 'waiting', for: 'resume' } })
  expect(h.chatRequests()).toEqual([])

  await run(client['agent.settings.change'](change('op-3', { _tag: 'paused', value: false })))
  await settings.where((p) => !p.paused, 'resumed')
  await pageWhere((p) => p.banner._tag === 'none' && of(p, 'juno').length === 1, 'the answer after Resume')
})

it('shows when OpenRouter rejected its key, until main sends a new one', async () => {
  const { h, client, follow, connection } = await served({ now: () => NOON })
  const settings = follow(client['agent.settings.page']())
  await settings.where((p) => p.openRouterKey === 'set', 'the key set')

  h.fake.script([rejectedKey()])
  await run(client['agent.chat.send']({ opId: OpId.make('op-1'), text: 'hello' }))
  await h.ended('op-1')
  await settings.where((p) => p.openRouterKey === 'rejected', 'the key rejected')

  connection.set({ _tag: 'openRouter', key: 'sk-or-v1-other' })
  await settings.where((p) => p.openRouterKey === 'set', 'a new key')
})

/** A Mac with a backup, served to the renderer. */
const mac = (name: string) => served({ now: () => NOON, backup: { keychain: fakeKeychain(), deviceName: name, intervalMs: 0 } })

it('a backup folder Juno cannot use is refused with the reason, and the backup stays where it was', async () => {
  const { client, follow } = await mac('Studio')
  const settings = follow(client['agent.settings.page']())
  const before = await settings.where((p) => p.ownership._tag === 'active', 'the page')
  const folder = (opId: string, path: string) => run(client['agent.settings.change'](change(opId, { _tag: 'backupFolder', path })))

  // A path under a file: the folder can never be made.
  const file = join(tempDir(), 'notes.txt')
  writeFileSync(file, 'not a folder')
  const underFile = await folder('op-1', join(file, 'Juno'))
  // Another Mac's backup: writing there would delete it.
  const theirs = tempDir()
  const other = await mac('Laptop')
  await run(other.client['agent.settings.change'](change('op-1', { _tag: 'backupFolder', path: theirs })))
  const foreign = await folder('op-2', theirs)
  expect([underFile, foreign]).toMatchObject([
    { _tag: 'Failure', failure: { reason: 'invalid' } },
    { _tag: 'Failure', failure: { reason: 'invalid' } },
  ])
  // Each says its own reason.
  const message = (result: typeof foreign) => (result._tag === 'Failure' ? result.failure.message : '')
  expect(message(underFile)).not.toBe(message(foreign))
  expect((await settings.where((p) => p.ownership._tag === 'active', 'the page')).backupFolder).toBe(before.backupFolder)
})

it('Rules: the owner sets them in Settings, the page lists them, and the next request carries them', async () => {
  const { h, client, follow } = await served({ now: () => NOON })
  const settings = follow(client['agent.settings.page']())
  const rules = [{ id: 'r1', text: 'Ask before writing to #general.' }, { id: 'r2', text: 'Never message Sam on weekends.' }] as never as ReadonlyArray<{ id: never; text: string }>
  expect(await run(client['agent.settings.change'](change('op-1', { _tag: 'rules', rules })))).toMatchObject({ _tag: 'Success' })
  expect((await settings.where((p) => p.rules.length === 2, 'two rules')).rules).toEqual(rules)
  const multiLine = await run(client['agent.settings.change'](change('op-2', { _tag: 'rules', rules: [{ id: 'r3' as never, text: 'one\ntwo' }] })))
  expect(multiLine).toMatchObject({ _tag: 'Failure', failure: { reason: 'invalid' } })

  h.fake.script([reply(say('Noted.'))])
  await run(client['agent.chat.send']({ opId: OpId.make('op-3'), text: 'hi' }))
  await h.ended('op-3')
  const request = JSON.stringify(h.chatRequests().at(-1)!.context)
  expect(request).toContain('Ask before writing to #general.')
  expect(request).toContain('Never message Sam on weekends.')
})

/** A model step that proposes one Send message. */
const send = (id: string) => reply({ type: 'toolCall', id, name: 'send_message', arguments: { messages: [{ topic: `m:${TEST_CHANNEL}`, text: `Text ${id}` }] } })

it('Activity lists each finished run newest first, how it ended, and its actions with the decision and outcome', async () => {
  const slack = fakeActionHost()
  let now = NOON
  const { h, client, follow } = await served({ actions: { host: slack.host }, now: () => now })
  h.fake.script([send('call-a'), send('call-b'), reply(say('Two drafts.'))])
  h.send('draft two messages', { opId: 'op-1' })
  await h.ended('op-1')
  const [kept, dropped] = h.turns.actions.views()
  slack.next('unknown')
  h.turns.actions.approve('click-1', kept!.binding!.identity, kept!.binding!.children)
  h.turns.actions.dismiss(dropped!.binding!.identity)
  await h.turns.actions.idle()
  h.fake.script([reply('Nothing worth saying.'), rejectedKey()])
  for (const n of [2, 3]) {
    now += 60_000
    h.send(`message ${n}`, { opId: `op-${n}` })
    await h.ended(`op-${n}`)
  }

  const activity = follow(client['agent.activity.page']({ window: { limit: 50 } }))
  const page = await activity.where((p) => p.runs.length === 3 && p.runs[2]!.actions.length === 2, 'three runs and the actions')
  expect(page.moreAbove).toBe(false)
  expect(page.runs.map((r) => [r.trigger, r.outcome])).toEqual([
    [{ _tag: 'message', words: 'message 3', files: 0 }, 'failed'],
    [{ _tag: 'message', words: 'message 2', files: 0 }, 'stayedQuiet'],
    [{ _tag: 'message', words: 'draft two messages', files: 0 }, 'replied'],
  ])
  expect(page.runs[2]!.actions.map((a) => [a.tier, a.decision, a.outcome, a.failure !== undefined])).toEqual([
    [3, 'approved', 'unknown', true],
    [3, 'dismissed', 'none', false],
  ])

  // Paging back from the newest run shown.
  const older = await follow(client['agent.activity.page']({ window: { limit: 2, cursor: page.runs[0]!.id as never } })).where(() => true, 'an older window')
  expect(older).toMatchObject({ runs: [{ outcome: 'stayedQuiet' }, { outcome: 'replied' }], moreAbove: false })
})

it('the message menu pins a UTF-8 span with Undo for a minute, and removing the source while paused drops the pin', async () => {
  let now = NOON
  const { h, client, follow, pageWhere } = await served({ now: () => now })
  const opId = OpId.make('menu-message')
  const text = 'My notes: café on Tuesday. Ask first.'
  h.fake.script([reply(say('I have your notes.'))])
  await run(client['agent.chat.send']({ opId, text }))
  await h.turns.idle()
  const menu = await run(client['agent.chat.message']({ target: { _tag: 'owner', opId } }))
  if (menu._tag !== 'Success' || menu.success === null) throw new Error('Missing menu')
  const message = menu.success
  expect(message.sheet.messages[0]?.preview).toBe(text)
  now += 1
  // The renderer sends byte offsets: `é` is two bytes.
  const startByte = Buffer.byteLength('My notes: ')
  const endByte = startByte + Buffer.byteLength('café on Tuesday')
  expect(await run(client['agent.remembers.pin']({ opId: OpId.make('pin-span'), messageId: message.messageId, revision: message.revision, startByte, endByte }))).toMatchObject({ _tag: 'Success' })
  const remembers = follow(client['agent.remembers.page']())
  expect((await remembers.where((p) => p.page.pins.length === 1, 'one pin')).page.pins[0]).toMatchObject({ text: 'café on Tuesday', source: { messageId: message.messageId } })
  await pageWhere((p) => of(p, 'note').some((i) => i.kind === 'remembered' && i.text === 'café on Tuesday' && i.undo === true), 'the pin note with Undo')
  now += 60_001
  await pageWhere((p) => of(p, 'note').some((i) => i.kind === 'remembered' && i.undo === undefined), 'Undo expired')

  h.turns.setMode('paused')
  await run(client['agent.chat.remove']({ opId: OpId.make('remove-source'), messageId: message.messageId, alsoRemoveReply: false }))
  await pageWhere((p) => of(p, 'note').some((i) => i.kind === 'removed'), 'removed')
  await remembers.where((p) => p.page.pins.length === 0, 'the pin gone')
})

it('What Juno remembers: a repeated pin is one pin, Undo takes back that pin, edits and removes check the revision, and the next send closes Undo', async () => {
  let now = NOON
  const { h, client, follow, pageWhere } = await served({ now: () => now })
  const opId = OpId.make('undo-message')
  h.fake.script([reply(say('Noted.'))])
  await run(client['agent.chat.send']({ opId, text: 'I prefer short answers' }))
  await h.turns.idle()
  const menu = await run(client['agent.chat.message']({ target: { _tag: 'owner', opId } }))
  if (menu._tag !== 'Success' || menu.success === null) throw new Error('Missing menu')
  const message = menu.success
  const remembers = follow(client['agent.remembers.page']())
  const pin = (op: string, revision = message.revision) => run(client['agent.remembers.pin']({ opId: OpId.make(op), messageId: message.messageId, revision, startByte: 2, endByte: 22 }))

  // The same operation twice, as a redelivery, is one pin.
  now += 1
  expect(await pin('first-pin')).toMatchObject({ _tag: 'Success' })
  expect(await pin('first-pin')).toMatchObject({ _tag: 'Success' })
  const one = await remembers.where((p) => p.page.pins.length === 1, 'one pin')
  expect(one.page).toMatchObject({ pins: [{ text: 'prefer short answers' }], usedBytes: 20 })
  // Undo is a remove of that pin.
  await run(client['agent.remembers.remove']({ opId: OpId.make('undo-pin'), id: one.revisions[0]!.id, revision: one.revisions[0]!.revision }))
  await pageWhere((p) => !of(p, 'note').some((i) => i.kind === 'remembered'), 'undone')
  await remembers.where((p) => p.page.pins.length === 0, 'no pins')

  now += 1
  await pin('second-pin')
  const pinned = await remembers.where((p) => p.page.pins.length === 1, 'the second pin')
  const { id, revision } = pinned.revisions[0]!
  await run(client['agent.remembers.edit']({ opId: OpId.make('edit'), id, revision, text: 'Short answers, please' }))
  const edited = await remembers.where((p) => p.page.pins[0]?.text === 'Short answers, please', 'the edit')
  // An edited pin no longer quotes its message.
  expect(edited.page.pins[0]!.source).toBeUndefined()
  expect(await run(client['agent.remembers.edit']({ opId: OpId.make('stale-edit'), id, revision, text: 'again' }))).toMatchObject({ _tag: 'Failure', failure: { reason: 'stale' } })

  // The next send closes Undo on the pin's note.
  now += 1
  h.fake.script([reply(say('Ok.'))])
  await run(client['agent.chat.send']({ opId: OpId.make('next-message'), text: 'Next message' }))
  const page = await pageWhere((p) => of(p, 'owner').some((i) => i.opId === 'next-message'), 'next send')
  expect(of(page, 'note').find((i) => i.kind === 'remembered')).not.toHaveProperty('undo')

  await run(client['agent.remembers.remove']({ opId: OpId.make('remove'), id, revision: edited.revisions[0]!.revision }))
  await remembers.where((p) => p.page.pins.length === 0, 'the pin removed')
  // A pin of a message that changed since the menu opened is refused.
  expect(await pin('stale-pin', Revision.make(message.revision + 1))).toMatchObject({ _tag: 'Failure', failure: { reason: 'stale' } })
})
