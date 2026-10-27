// Draft sync around sends, end to end against the fake (SPEC 8 "Drafts", specs/drafts.qnt): a retry of a refused
// post names no draft, so newer text and a file on it stay; a text sent elsewhere is settled once a list lacks its
// draft; a sent text never comes back from its create's late echo, even after many more sends; a create whose
// draft was deleted before its text went is settled; and a failed create is found or made again when its first
// list starts in the same millisecond.
import { afterEach, expect, it } from 'bun:test'
import { messagesRetry, messagesSend } from '@juno/contract'
import { runCommand } from '@juno/state'
import { clockAt, controlledClock, noTicks } from '../controlledClock'
import { MAIN, PAUSE, THREAD, hasFiles, linked, nextPost, owed, postState, send, sentRecords, settled, stored, type } from '../draftScenario'
import { waitFor, type RunningEngine } from '../harness'
import { apiCalls, threadId, tsOf, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const clocks: Array<Awaited<ReturnType<typeof controlledClock>>> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
  for (const clock of clocks.splice(0)) await clock.close()
})

it('retrying a refused message posts it without naming the draft, which keeps newer text and the phone’s file', async () => {
  const engine = await syncedEngine(engines, { timing: { draftSaveMillis: PAUSE } })
  const { fake } = engine
  /** Sends the Main's draft and has Slack refuse the post. */
  const refusedSend = async (text: string) => {
    fake.gate((method) => method === 'chat.postMessage')
    const clientMsgId = crypto.randomUUID()
    valueOf(await runCommand(engine.registry, messagesSend, { to: { kind: 'channel', channelId: 'C0ENG' }, text, clientMsgId, draftOf: MAIN }))
    const post = await waitFor(() => fake.gated().find((call) => call.method === 'chat.postMessage' && call.stage === 'before'), 15_000, 'the post at Slack')
    fake.decide(post.id, { error: 'msg_too_long' })
    fake.gate()
    await waitFor(() => (postState(engine, clientMsgId) === 'failed' ? true : undefined), 15_000, 'the post refused')
    return clientMsgId
  }
  /** Retries the post and waits until Slack has it; answers the call that posted it. */
  const retried = async (clientMsgId: string) => {
    const posts = apiCalls(engine, 'chat.postMessage').length
    valueOf(await runCommand(engine.registry, messagesRetry, { clientMsgId }))
    const post = await nextPost(engine, posts)
    await waitFor(() => (postState(engine, clientMsgId) === undefined ? true : undefined), 15_000, 'the post in Slack')
    await engine.socketIdle()
    return post
  }

  await step('text typed and saved after the refusal stays the draft, in Slack and in Juno', async () => {
    await type(engine, 'The first try', true)
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
    const failed = await refusedSend('The first try')
    await type(engine, 'Typed after the refusal', true)
    await waitFor(() => (fake.draftText('C0ENG') === 'Typed after the refusal' ? true : undefined), 15_000, 'the newer text in Slack')
    expect((await retried(failed)).args['draft_id']).toBeUndefined()
    expect(fake.draftText('C0ENG')).toBe('Typed after the refusal')
    expect(stored(engine)).toBe('Typed after the refusal')
  })

  await step('a file the phone attached after the refusal stays on its draft', async () => {
    await waitFor(() => settled(engine), 15_000, 'the draft linked')
    const failed = await refusedSend('Typed after the refusal')
    fake.putDraft({ channel: 'C0ENG', text: 'Typed after the refusal', files: 1 })
    await waitFor(() => (hasFiles(engine) ? true : undefined), 15_000, 'the file known in Juno')
    expect((await retried(failed)).args['draft_id']).toBeUndefined()
    expect(fake.draft('C0ENG')?.fileIds.length).toBe(1)
  })
})

it('a text sent elsewhere is settled once a list shows its draft deleted while Juno heard nothing', async () => {
  const engine = await syncedEngine(engines, { timing: { draftSaveMillis: PAUSE } })
  const { fake } = engine
  await type(engine, 'Meant for the thread', true)
  const draftId = await waitFor(() => settled(engine), 15_000, 'the draft linked')
  await send(engine, 'Meant for the thread', tsOf(threadId(fake, 'C0ENG', THREAD)))
  // The phone deletes the draft the text went from, and its event is lost; the next catch-up lists the drafts.
  fake.holdFrames({ types: ['draft_delete'] })
  fake.removeDraft({ channel: 'C0ENG' })
  fake.releaseFrames({ drop: true })
  fake.dropSocket()
  await waitFor(() => (sentRecords(engine).find((each) => each.id === draftId)?.settled === true ? true : undefined), 15_000, 'the sent record settled')
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

it('a create whose draft the phone deleted before its text went leaves no record to keep', async () => {
  const engine = await syncedEngine(engines, { timing: { draftSaveMillis: PAUSE } })
  const { fake } = engine
  fake.holdFrames({ types: ['draft_create'] })
  fake.holdNext({ method: 'drafts.create' })
  await type(engine, 'Deleted on the phone before it went', true)
  await waitFor(() => (fake.heldCount({ method: 'drafts.create' }) === 1 ? true : undefined), 15_000, 'the create made')
  // The phone deletes the new draft, and Juno hears of it before its create's answer.
  fake.removeDraft({ channel: 'C0ENG' })
  await engine.socketIdle()
  await send(engine, 'Deleted on the phone before it went')
  fake.release({ method: 'drafts.create' })
  await waitFor(() => (owed(engine) ? undefined : true), 15_000, 'the create answered')
  fake.releaseFrames()
  await engine.socketIdle()
  // The draft the text went from is gone, so the record of it is settled and can be forgotten.
  expect(sentRecords(engine).map((each) => each.settled)).toEqual([true])
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
