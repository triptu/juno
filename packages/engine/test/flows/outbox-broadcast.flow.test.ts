// Also send to the channel (SPEC 7) through the outbox (architecture 5.7): `chat.update` with
// `reply_broadcast` and no text sends an own reply to Main. The reply shows there and is marked in its thread
// at once; a refusal takes both back, an edit before it keeps its order, and a lost answer and socket event
// are reconciled by one read of the reply in Main. Every test starts warm on the synced default workspace.
import { expect, it } from 'bun:test'
import { broadcastMessage, editMessage, openTopic, sendMessage } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { eng, fresh, inSlack, MAIN, outboxScenario, refOf, rowWith, type Watch } from '../outboxScenario'
import { apiCalls, readDb, valueOf } from '../scenario'
import { step } from '../step'

const { booted, watch, opened, restarted } = outboxScenario()

const POSTGRES = 'Draft plan is in the doc'
const broadcastRows = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => db.prepare(`SELECT count(*) AS n FROM outbox WHERE kind = 'broadcast'`).get() as { n: number }).n
const broadcastsEnded = (engine: RunningEngine, label: string) => waitFor(() => (broadcastRows(engine) === 0 ? true : undefined), WAIT_MS, label)

/** Posts `text` as an own reply in the Postgres thread and answers its stored row. */
async function ownReply(engine: RunningEngine, thread: Watch, root: string, text: string) {
  valueOf(await sendMessage(engine.registry, { ...eng, threadTs: root }, text, `t:C0ENG:${root}`))
  return rowWith(await thread((list) => rowWith(list, text) !== undefined && rowWith(list, text)!.pending === undefined, `"${text}" stored`), text)!
}

it('sends an own reply to the channel too, and reconciles a refusal, an edit before it and a lost answer', async () => {
  const first = await booted()
  const root = first.fake.messages('C0ENG').find((m) => m.text?.startsWith(POSTGRES))!.ts
  const topic = `t:C0ENG:${root}`
  valueOf(await openTopic(first.registry, topic))
  const thread = await opened(first, topic)
  const main = await opened(first)

  await step('a refused broadcast takes the copy out of Main and the mark off the reply', async () => {
    const reply = await ownReply(first, thread, root, 'Refused broadcast')
    await fresh(first)
    first.fake.forceError({ method: 'chat.update', error: 'cant_broadcast_message' })
    first.fake.holdNext({ method: 'chat.update', before: true })
    valueOf(await broadcastMessage(first.registry, refOf(reply)))
    await thread((list) => rowWith(list, 'Refused broadcast')?.broadcast === true, 'marked at once')
    await main((list) => rowWith(list, 'Refused broadcast') !== undefined, 'in Main at once')
    first.fake.release()
    await broadcastsEnded(first, 'the refusal ended')
    await main((list) => rowWith(list, 'Refused broadcast') === undefined, 'out of Main')
    await thread((list) => rowWith(list, 'Refused broadcast')?.broadcast === false, 'the mark gone')
  })

  await step('an edit and then a broadcast of one reply go in order, as separate calls', async () => {
    const reply = await ownReply(first, thread, root, 'Keep the old primary warm')
    await fresh(first)
    first.fake.holdNext({ method: 'chat.update', before: true })
    valueOf(await editMessage(first.registry, refOf(reply), 'Keep the old primary warm until Friday.'))
    await waitFor(() => (first.fake.heldCount({ method: 'chat.update' }) === 1 ? true : undefined), WAIT_MS, 'the held edit')
    valueOf(await broadcastMessage(first.registry, refOf(reply)))
    await thread((list) => rowWith(list, 'Keep the old primary warm until Friday.')?.broadcast === true, 'edited and marked')
    first.fake.release()
    await waitFor(() => (inSlack(first, reply.ts)?.subtype === 'thread_broadcast' ? true : undefined), WAIT_MS, 'the broadcast in Slack')
    await broadcastsEnded(first, 'the broadcast ended')
    expect(inSlack(first, reply.ts)?.text).toBe('Keep the old primary warm until Friday.')
    expect(apiCalls(first, 'chat.update').map((call) => [call.args['text'], call.args['reply_broadcast']])).toEqual([
      ['Keep the old primary warm until Friday.', undefined],
      [undefined, 'true'],
    ])
    await main((list) => rowWith(list, 'Keep the old primary warm until Friday.')?.broadcastFrom?.title.startsWith(POSTGRES) === true, 'in Main, from its thread')
  })

  await step('a broadcast whose answer and socket event are lost is found in Main before its row ends, and stays after a restart', async () => {
    const reply = await ownReply(first, thread, root, 'Lost broadcast answer')
    await fresh(first)
    first.fake.holdFrames({ types: ['message'] })
    first.fake.loseResponse({ method: 'chat.update' })
    valueOf(await broadcastMessage(first.registry, refOf(reply)))
    await broadcastsEnded(first, 'the broadcast ended')
    // Sent again, Slack refuses it as already sent; one read of that ts in Main proves it.
    expect(apiCalls(first, 'chat.update').map((call) => call.error)).toEqual(['lost', 'cant_broadcast_message'])
    expect(apiCalls(first, 'conversations.history').some((call) => call.args['oldest'] === reply.ts && call.args['latest'] === reply.ts)).toBe(true)
    first.fake.releaseFrames({ drop: true })
    await thread((list) => rowWith(list, 'Lost broadcast answer')?.broadcast === true, 'marked in the thread')
    await main((list) => rowWith(list, 'Lost broadcast answer')?.broadcastFrom?.title.startsWith(POSTGRES) === true, 'in Main, from its thread')
    const engine = await restarted(first)
    await watch(engine, MAIN)((list) => rowWith(list, 'Lost broadcast answer')?.broadcastFrom?.title.startsWith(POSTGRES) === true, 'in Main after the restart')
  })
})
