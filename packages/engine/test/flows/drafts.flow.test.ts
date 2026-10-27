// Topic drafts synced with Slack (SPEC 8 "Drafts", specs/drafts.qnt), end to end against the fake: typing
// that pauses makes one save, a draft changed on another device shows, a newer local edit wins over an older
// change from another device and goes back to Slack, a send retires the draft everywhere, clearing deletes
// it (with the edit time Slack checks), a draft of files alone stays the place's draft, a send that went
// elsewhere leaves no draft behind, a save or a list's absence never acts on what changed under it, an edit
// made offline reaches Slack once Juno is back, after a restart too, local text another device replaced stays
// kept for ⌘Z, a slow save answer never forgets newer files, a refused save never stops a newer edit, and a
// failed create is found or made again when its first list starts in the same millisecond. The fake refuses
// an implausible `client_last_updated_ts`, as Slack does. Every step starts warm on the synced default
// workspace and goes on from the step before.
import { afterEach, expect, it } from 'bun:test'
import { draftsSet, messagesSend } from '@juno/contract'
import { runCommand } from '@juno/state'
import { controlledClock, noTicks } from '../controlledClock'
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
/** The local text Juno keeps for ⌘Z, and the files Juno knows Slack's draft has. */
const kept = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => (db.prepare('SELECT replaced FROM draft_sync WHERE topic_id = ?').get(MAIN) as { replaced: string | null } | undefined)?.replaced ?? undefined)
const knownFiles = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => JSON.parse((db.prepare('SELECT file_ids FROM draft_sync WHERE topic_id = ?').get(MAIN) as { file_ids: string | null } | undefined)?.file_ids ?? '[]') as ReadonlyArray<string>)
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

  await step('a draft of files alone from another device stays the place’s draft: Juno’s text goes onto it, and a send keeps its files', async () => {
    const before = draftCalls(engine).length
    const draft = fake.putDraft({ channel: 'C0ENG', text: '', files: 1 })
    await waitFor(() => (linked(engine) === draft.id ? true : undefined), 15_000, 'the files draft linked')
    await type(engine, 'A caption for the file', true)
    await waitFor(() => (fake.draft('C0ENG')?.text === 'A caption for the file' ? true : undefined), 15_000, 'the caption on the draft')
    expect(fake.draft('C0ENG')?.fileIds).toEqual(draft.file_ids)
    expect(draftCalls(engine).slice(before).map((call) => call.method)).toEqual(['drafts.update'])
    // The message goes without the files, which Juno does not show: the draft keeps them, with no text.
    await send(engine, 'A caption for the file')
    await waitFor(() => (fake.draft('C0ENG')?.text === '' ? true : undefined), 15_000, 'the draft emptied, files kept')
    expect(fake.draft('C0ENG')?.fileIds).toEqual(draft.file_ids)
    expect(apiCalls(engine, 'chat.postMessage').at(-1)?.args['draft_id']).toBeUndefined()
    fake.removeDraft({ channel: 'C0ENG' })
    await waitFor(() => (linked(engine) === undefined ? true : undefined), 15_000, 'the deletion in Juno')
  })

  await step('a send that goes into a thread instead leaves no draft behind in the Main', async () => {
    await type(engine, 'This belongs in the thread', true)
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
    await send(engine, 'This belongs in the thread', tsOf(threadId(fake, 'C0ENG', 'Draft plan is in the doc')))
    await waitFor(() => (fake.draftText('C0ENG') === undefined ? true : undefined), 15_000, 'the Main draft deleted in Slack')
    expect(apiCalls(engine, 'chat.postMessage').at(-1)?.args['draft_id']).toBeUndefined()
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

  await step('a slow save answer does not forget a file another device added after the save', async () => {
    engine.fake.holdNext({ method: 'drafts.update' })
    await type(engine, 'Text the phone adds a file to', true)
    await waitFor(() => (engine.fake.heldCount({ method: 'drafts.update' }) === 1 ? true : undefined), 15_000, 'the save out')
    const withFile = engine.fake.putDraft({ channel: 'C0ENG', text: 'Text the phone adds a file to', files: 1 })
    await waitFor(() => (knownFiles(engine).length === 1 ? true : undefined), 15_000, 'the file known in Juno')
    engine.fake.release({ method: 'drafts.update' })
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
    expect(knownFiles(engine)).toEqual(withFile.file_ids ?? [])
    await type(engine, 'Text written after the file', true)
    await waitFor(() => (engine.fake.draft('C0ENG')?.text === 'Text written after the file' ? true : undefined), 15_000, 'the new text in Slack')
    expect(engine.fake.draft('C0ENG')?.fileIds).toEqual(withFile.file_ids)
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
