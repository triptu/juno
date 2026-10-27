// Topic drafts synced with Slack (SPEC 8 "Drafts", specs/drafts.qnt), end to end against the fake: typing
// that pauses makes one save, a draft changed on another device shows, a newer local edit wins over an older
// change from another device and goes back to Slack, a send retires the draft everywhere, and an edit made
// offline reaches Slack once Juno is back, after a restart too. Every step starts warm on the synced default
// workspace and goes on from the step before.
import { afterEach, expect, it } from 'bun:test'
import { draftsSet, messagesSend } from '@juno/contract'
import { runCommand } from '@juno/state'
import { waitFor, type RunningEngine } from '../harness'
import { apiCalls, readDb, restart, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
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
    valueOf(await runCommand(engine.registry, messagesSend, { to: { kind: 'channel', channelId: 'C0ENG' }, text: 'Typed in Juno after the phone', clientMsgId: crypto.randomUUID(), draftOf: MAIN }))
    await waitFor(() => (fake.draftText('C0ENG') === undefined ? true : undefined), 15_000, 'the draft gone from Slack')
    expect(apiCalls(engine, 'chat.postMessage').at(-1)?.args['draft_id']).toBe(draftId)
    expect(stored(engine)).toBeUndefined()
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
})
