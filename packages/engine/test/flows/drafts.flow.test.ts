// Topic drafts synced with Slack (SPEC 8 "Drafts", specs/drafts.qnt), end to end against the fake: typing
// that pauses makes one save, a draft changed on another device shows, a newer local edit wins over an older
// change from another device and goes back to Slack, a send retires the draft everywhere, clearing deletes
// it (with the edit time Slack checks), a draft with files from another device is shown but never changed, a
// send that went elsewhere leaves Slack's draft and the phone's newer text on it, a save or a list's absence
// never acts on what changed under it, an edit made offline reaches Slack once Juno is back, after a restart
// too, local text another device replaced stays kept for ⌘Z, a refused save never stops a newer edit, a sent
// text never comes back from its create's late echo, even after many more sends, and a failed create is found
// or made again when its first list starts in the same millisecond. Juno deletes a draft only when the user
// clears it. The fake refuses an implausible `client_last_updated_ts`, as Slack does. Steps start warm on the
// synced default workspace and go on from the step before.
import { afterEach, expect, it } from 'bun:test'
import { draftsSet, messagesSend } from '@juno/contract'
import { runCommand } from '@juno/state'
import { clockAt, controlledClock, noTicks } from '../controlledClock'
import { waitFor, type RunningEngine } from '../harness'
import { apiCalls, readDb, restart, threadId, tsOf, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const clocks: Array<Awaited<ReturnType<typeof controlledClock>>> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
  for (const clock of clocks.splice(0)) await clock.close()
})

const MAIN = 'm:C0ENG'
/** A pause long enough that a few commands in a row always land inside it. */
const PAUSE = 1_000

const type = async (engine: RunningEngine, text: string, now = false) => valueOf(await runCommand(engine.registry, draftsSet, { topicId: MAIN, text, ...(now ? { now } : {}) }))
const stored = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => (db.prepare('SELECT text FROM drafts WHERE topic_id = ?').get(MAIN) as { text: string } | undefined)?.text)
/** Juno links Slack's draft and owes it nothing. */
const settled = (engine: RunningEngine) =>
  readDb(engine, 'user.db', (db) => {
    const link = (db.prepare('SELECT slack_id FROM draft_sync WHERE topic_id = ?').get(MAIN) as { slack_id: string | null } | undefined)?.slack_id
    const owed = db.prepare("SELECT 1 FROM outbox WHERE kind = 'draft' AND target_key = ?").get(MAIN) !== undefined
    return link !== null && link !== undefined && !owed ? link : undefined
  })
const draftCalls = (engine: RunningEngine) => engine.fake.calls.filter((call) => call.kind === 'api' && ['drafts.create', 'drafts.update', 'drafts.delete'].includes(call.method))
/** The Slack draft Juno links for the Main, owed or not. */
const linked = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => (db.prepare('SELECT slack_id FROM draft_sync WHERE topic_id = ?').get(MAIN) as { slack_id: string | null } | undefined)?.slack_id ?? undefined)
/** Whether the Main has a pending `draft` row. */
const owed = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => db.prepare("SELECT 1 FROM outbox WHERE kind = 'draft' AND target_key = ?").get(MAIN) !== undefined)
/** The local text Juno keeps for ⌘Z. */
const kept = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => (db.prepare('SELECT replaced FROM draft_sync WHERE topic_id = ?').get(MAIN) as { replaced: string | null } | undefined)?.replaced ?? undefined)
const THREAD = 'Draft plan is in the doc'
const send = async (engine: RunningEngine, text: string, threadTs?: string) =>
  valueOf(await runCommand(engine.registry, messagesSend, { to: { kind: 'channel', channelId: 'C0ENG', ...(threadTs === undefined ? {} : { threadTs }) }, text, clientMsgId: crypto.randomUUID(), draftOf: MAIN }))

it('drafts reach Slack after a pause, come back from other devices, keep newer typing, leave with a send and wait out being offline', async () => {
  let engine = await syncedEngine(engines, { timing: { draftSaveMillis: PAUSE } })
  const { fake } = engine

  await step('typing that pauses makes one save, with the last text', async () => {
    const before = draftCalls(engine).length
    await type(engine, 'Can we move')
    await type(engine, 'Can we move the cutover')
    await type(engine, 'Can we move the cutover to Thursday?')
    await waitFor(() => (fake.draftText('C0ENG') === 'Can we move the cutover to Thursday?' ? true : undefined), 15_000, 'the draft in Slack')
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
    expect(draftCalls(engine).slice(before).map((call) => call.method)).toEqual(['drafts.create'])
  })

  await step('a change on another device shows in Juno', async () => {
    fake.putDraft({ channel: 'C0ENG', text: 'Can we move the cutover to Friday?' })
    await waitFor(() => (stored(engine) === 'Can we move the cutover to Friday?' ? true : undefined), 15_000, 'the phone’s draft in Juno')
  })

  await step('an older change from another device does not replace newer typing, which goes back to Slack', async () => {
    // The phone saved before Juno's edit, but its event arrives after it.
    fake.holdFrames({ types: ['draft_update'] })
    fake.putDraft({ channel: 'C0ENG', text: 'Phone text from before', at: fake.now() - 2 })
    await type(engine, 'Typed in Juno after the phone')
    fake.releaseFrames()
    await waitFor(() => (fake.draftText('C0ENG') === 'Typed in Juno after the phone' ? true : undefined), 15_000, 'Juno’s text back in Slack')
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
    expect(stored(engine)).toBe('Typed in Juno after the phone')
  })

  await step('sending the draft retires it in Slack', async () => {
    const draftId = settled(engine)
    await send(engine, 'Typed in Juno after the phone')
    await waitFor(() => (fake.draftText('C0ENG') === undefined ? true : undefined), 15_000, 'the draft gone from Slack')
    expect(apiCalls(engine, 'chat.postMessage').at(-1)?.args['draft_id']).toBe(draftId)
    expect(stored(engine)).toBeUndefined()
  })

  await step('clearing a draft deletes it in Slack, with the time of the clear', async () => {
    await type(engine, 'Second thoughts', true)
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
    await type(engine, '', true)
    await waitFor(() => (fake.draftText('C0ENG') === undefined && linked(engine) === undefined ? true : undefined), 15_000, 'the draft deleted in Slack')
  })

  await step('a draft with files from another device shows, but Juno never updates or deletes it, and a send does not name it', async () => {
    const before = draftCalls(engine).length
    const draft = fake.putDraft({ channel: 'C0ENG', text: 'Caption from the phone', files: 1 })
    await waitFor(() => (linked(engine) === draft.id && stored(engine) === 'Caption from the phone' ? true : undefined), 15_000, 'the files draft shown')
    // Typing there, clearing and sending stay in Juno.
    await type(engine, 'Typed in Juno over it', true)
    await engine.workPass('draft')
    await type(engine, '', true)
    await engine.workPass('draft')
    await type(engine, 'Sent from the files draft', true)
    await send(engine, 'Sent from the files draft')
    await engine.workPass('draft')
    expect(draftCalls(engine).slice(before)).toEqual([])
    expect(apiCalls(engine, 'chat.postMessage').at(-1)?.args['draft_id']).toBeUndefined()
    expect(fake.draft('C0ENG')).toEqual({ text: 'Caption from the phone', fileIds: draft.file_ids ?? [] })
    // The phone removes it, which leaves the Main with no draft for the steps after.
    fake.removeDraft({ channel: 'C0ENG' })
    await waitFor(() => (linked(engine) === undefined ? true : undefined), 15_000, 'the deletion in Juno')
  })

  await step('a send into a thread leaves the Main’s draft in Slack, and the phone’s newer text on it shows in the Main', async () => {
    await type(engine, 'Meant for the thread', true)
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
    // The phone writes on the draft as the send goes; Juno hears it after.
    fake.holdFrames({ types: ['draft_update'] })
    fake.putDraft({ channel: 'C0ENG', text: 'Phone text written meanwhile' })
    await send(engine, 'Meant for the thread', tsOf(threadId(fake, 'C0ENG', THREAD)))
    fake.releaseFrames()
    await waitFor(() => (stored(engine) === 'Phone text written meanwhile' ? true : undefined), 15_000, 'the phone’s text in the Main')
    expect(fake.draftText('C0ENG')).toBe('Phone text written meanwhile')
    expect(apiCalls(engine, 'chat.postMessage').at(-1)?.args['draft_id']).toBeUndefined()
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
  })

  await step('a newer change from another device that lands while a save is about to go: the older text never goes', async () => {
    const before = draftCalls(engine).length
    const hold = engine.holdDraftWrite('claim', MAIN)
    await type(engine, 'Juno text the phone replaces')
    await hold.reached
    fake.putDraft({ channel: 'C0ENG', text: 'Phone text, newer' })
    await waitFor(() => (stored(engine) === 'Phone text, newer' ? true : undefined), 15_000, 'the phone’s draft in Juno')
    hold.release()
    await hold.written
    await engine.workPass('draft')
    expect(draftCalls(engine).slice(before).filter((call) => String(call.args['blocks']).includes('Juno text the phone replaces'))).toEqual([])
    expect(fake.draftText('C0ENG')).toBe('Phone text, newer')
  })

  await step('a list that misses a deleted draft does not delete the newer one linked while it was read', async () => {
    // The phone deletes the draft and its event is lost; the next catch-up's list has no draft for the Main.
    fake.holdFrames({ types: ['draft_delete'] })
    fake.removeDraft({ channel: 'C0ENG' })
    fake.releaseFrames({ drop: true })
    const hold = engine.holdDraftWrite('absence', MAIN)
    const synced = engine.nextSync()
    fake.dropSocket()
    await synced
    await hold.reached
    // Before the list's absence is written, the phone starts a new draft there and its event links it.
    const newer = fake.putDraft({ channel: 'C0ENG', text: 'A new draft on the phone' })
    await waitFor(() => (linked(engine) === newer.id ? true : undefined), 15_000, 'the new draft linked')
    hold.release()
    await hold.written
    expect(linked(engine)).toBe(newer.id)
    expect(stored(engine)).toBe('A new draft on the phone')
    expect(fake.draftText('C0ENG')).toBe('A new draft on the phone')
  })

  await step('an edit made offline waits, and reaches Slack after a restart once Juno is back', async () => {
    const before = draftCalls(engine).length
    fake.goOffline()
    await waitFor(() => (engine.online() ? undefined : true), 15_000, 'Juno offline')
    await type(engine, 'Written on the train', true)
    // The sender has looked at the row since, and sent nothing.
    await engine.workPass('draft')
    expect(stored(engine)).toBe('Written on the train')
    expect(draftCalls(engine).length).toBe(before)
    engine = await restart(engines, engine, (stopped) => stopped.goOnline(), { timing: { draftSaveMillis: PAUSE } })
    await waitFor(() => (engine.fake.draftText('C0ENG') === 'Written on the train' ? true : undefined), 15_000, 'the offline draft in Slack')
  })

  await step('local text another device replaced while its save was out stays kept for ⌘Z through a second change there', async () => {
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
    engine.fake.holdNext({ method: 'drafts.update' })
    await type(engine, 'Juno text to bring back', true)
    await waitFor(() => (engine.fake.heldCount({ method: 'drafts.update' }) === 1 ? true : undefined), 15_000, 'the save out')
    engine.fake.putDraft({ channel: 'C0ENG', text: 'First phone text' })
    await waitFor(() => (stored(engine) === 'First phone text' ? true : undefined), 15_000, 'the first phone text in Juno')
    engine.fake.putDraft({ channel: 'C0ENG', text: 'Second phone text' })
    await waitFor(() => (stored(engine) === 'Second phone text' ? true : undefined), 15_000, 'the second phone text in Juno')
    expect(kept(engine)).toBe('Juno text to bring back')
    engine.fake.release({ method: 'drafts.update' })
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
    expect(kept(engine)).toBe('Juno text to bring back')
    expect(engine.fake.draftText('C0ENG')).toBe('Second phone text')
  })

  await step('a save Slack refuses for good does not stop the newer edit made while it was out', async () => {
    engine.fake.gate((method) => method === 'drafts.update')
    await type(engine, 'Text Slack refuses', true)
    const refused = await waitFor(() => engine.fake.gated().find((call) => call.method === 'drafts.update' && call.stage === 'before'), 15_000, 'the save at Slack')
    await type(engine, 'Text written while it was out', true)
    engine.fake.decide(refused.id, { error: 'msg_blocks_too_long' })
    engine.fake.gate()
    await waitFor(() => (engine.fake.draftText('C0ENG') === 'Text written while it was out' ? true : undefined), 15_000, 'the newer text in Slack')
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
  })

})

it('a sent text never comes back from its create’s late echo, on a clock running behind', async () => {
  // Juno's clock reads five seconds behind Slack's.
  const engine = await syncedEngine(engines, { clock: clockAt(Date.now() - 5_000), timing: { draftSaveMillis: PAUSE } })
  const { fake } = engine
  // Juno's create reaches Slack, but its answer and its echo are late; the text goes as a message meanwhile.
  fake.holdFrames({ types: ['draft_create'] })
  fake.holdNext({ method: 'drafts.create' })
  await type(engine, 'Sent while its draft was being made', true)
  await waitFor(() => (fake.heldCount({ method: 'drafts.create' }) === 1 ? true : undefined), 15_000, 'the create made')
  await send(engine, 'Sent while its draft was being made')
  fake.release({ method: 'drafts.create' })
  await waitFor(() => (owed(engine) ? undefined : true), 15_000, 'the create answered')
  fake.releaseFrames()
  await engine.socketIdle()
  expect(stored(engine)).toBeUndefined()
  expect(linked(engine)).toBeUndefined()
  // Juno deletes nothing on its own: the draft its create made stays in Slack.
  expect(fake.draftText('C0ENG')).toBe('Sent while its draft was being made')
})

it('a create unanswered when its text went is still known by its client_msg_id after more sends than the settled history keeps', async () => {
  const engine = await syncedEngine(engines, { timing: { draftSaveMillis: PAUSE } })
  const { fake } = engine
  fake.holdFrames({ types: ['draft_create'] })
  fake.holdNext({ method: 'drafts.create' })
  await type(engine, 'The first text, sent before its draft was known', true)
  await waitFor(() => (fake.heldCount({ method: 'drafts.create' }) === 1 ? true : undefined), 15_000, 'the create made')
  await send(engine, 'The first text, sent before its draft was known')
  for (let n = 1; n <= 21; n++) await send(engine, `Later message ${n}`)
  fake.release({ method: 'drafts.create' })
  await waitFor(() => (owed(engine) ? undefined : true), 15_000, 'the create answered')
  fake.releaseFrames()
  await engine.socketIdle()
  expect(stored(engine)).toBeUndefined()
  expect(linked(engine)).toBeUndefined()
})

it('a create that fails on the way is found or made again when its first list starts in the same millisecond', async () => {
  const time = await controlledClock()
  clocks.push(time)
  const engine = await syncedEngine(engines, { clock: time.clock, timing: { ...noTicks, draftSaveMillis: PAUSE } })
  const { fake } = engine
  await time.freeze()
  const lists = () => apiCalls(engine, 'drafts.list').length
  const listsBefore = lists()

  fake.gate((method) => method === 'drafts.create')
  await type(engine, 'Typed while time stands still', true)
  const create = await waitFor(() => fake.gated().find((call) => call.method === 'drafts.create' && call.stage === 'before'), 15_000, 'the create at Slack')
  // The connection fails before Slack runs it. Juno cannot tell, so it lists before creating again, at the same millisecond.
  fake.decide(create.id, { error: 'bad_gateway', status: 400 })
  fake.gate()
  await waitFor(() => (lists() > listsBefore ? true : undefined), 15_000, 'the first list')
  // That list cannot settle a find from its own millisecond. Engine time moves on a second at a time until another list goes.
  for (let second = 0; lists() === listsBefore + 1; second++) {
    if (second === 600) throw new Error('no list followed the one from the same millisecond')
    await engine.socketIdle()
    await time.advance(1_000)
  }
  await waitFor(() => (fake.draftText('C0ENG') === 'Typed while time stands still' ? true : undefined), 15_000, 'the draft in Slack')
})
