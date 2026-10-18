import { productionTiming } from '../src/config'
// The send workers sleep while a channel's first row waits out a backoff
// (performance.md section 1, "Idle CPU"). Each pass tries only the first row
// of a channel; the rows behind it wait. On 10-18 the owner's engine sat at
// 100 % of a core: a later row behind a waiting one was due, so the next
// wake was "now", and the worker ran its pass again at once, forever.
import { describe, expect, it } from 'vitest'
import { reactToMessage, sendMessage } from '@juno/state'
import { sleep, waitFor, WAIT_MS, type RunningEngine } from './harness'
import { readDb, valueOf } from './scenario'
import { actionRows, booted, eng, MAIN, refOf, sent, stopEnginesAfterEach, watch } from './actionScenario'

stopEnginesAfterEach()

/** performance.md section 1: under 3 % of one core while idle. The spin cost about 100 %. */
const IDLE_CPU_BUDGET_PERCENT = 3

/** This process's share of one core over `ms`: the engine and the fake run here. */
async function cpuOver(ms: number): Promise<number> {
  const before = process.cpuUsage()
  const started = performance.now()
  await sleep(ms)
  const used = process.cpuUsage(before)
  return ((used.user + used.system) / 1000 / (performance.now() - started)) * 100
}

const nextAt = (engine: RunningEngine, table: 'pending_messages' | 'outbox', id: string | number) =>
  readDb(engine, 'user.db', (db) => {
    const row = (table === 'pending_messages'
      ? db.prepare('SELECT next_at FROM pending_messages WHERE client_msg_id = ?').get(id)
      : db.prepare('SELECT next_at FROM outbox WHERE id = ?').get(id)) as { next_at: number | string } | undefined
    return row === undefined ? undefined : Number(row.next_at)
  })

describe('the send workers while a channel waits [production timing]', () => {
  it('sleep while a post waits to be looked up and a later post in its channel waits behind it', async () => {
    const engine = await booted({ timing: { ...productionTiming, sweepIntervalMillis: 0, followPassMillis: 0 } })
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    // The first post's answer is lost and its echo held, so it becomes a lookup; every lookup fails, so it backs off.
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    engine.fake.forceError({ method: 'conversations.history', error: 'request_timeout', times: 1_000 })
    valueOf(await sendMessage(engine.registry, eng, 'Lost on the way', MAIN))
    const first = await waitFor(
      () => readDb(engine, 'user.db', (db) => db.prepare(`SELECT client_msg_id AS id FROM pending_messages WHERE state = 'unknown'`).get() as { id: string } | undefined)?.id,
      WAIT_MS,
      'the first post waiting for its lookup',
    )
    await waitFor(() => ((nextAt(engine, 'pending_messages', first) ?? 0) - Date.now() > 1_500 ? true : undefined), WAIT_MS, 'a backoff')
    // Queued and due, but behind the first post.
    valueOf(await sendMessage(engine.registry, eng, 'Right behind it', MAIN))
    await sleep(200)

    expect(await cpuOver(2_000)).toBeLessThan(IDLE_CPU_BUDGET_PERCENT)
    expect(readDb(engine, 'user.db', (db) => db.prepare(`SELECT state FROM pending_messages ORDER BY created_at`).all())).toEqual([{ state: 'unknown' }, { state: 'queued' }])
  })

  it('sleep while a reaction waits out a backoff and a later one in its channel waits behind it', async () => {
    const engine = await booted({ timing: { ...productionTiming, sweepIntervalMillis: 0, followPassMillis: 0 } })
    const rows = watch(engine, MAIN)
    const one = await sent(engine, 'First to react to', rows)
    const two = await sent(engine, 'Second to react to', rows)
    // Slack's error is one the outbox retries with a backoff.
    engine.fake.forceError({ method: 'reactions.add', error: 'service_unavailable', times: 1_000 })
    valueOf(await reactToMessage(engine.registry, refOf(one), 'eyes', true))
    const first = await waitFor(
      () => readDb(engine, 'user.db', (db) => db.prepare(`SELECT id FROM outbox WHERE kind = 'react' AND attempts > 0`).get() as { id: number } | undefined)?.id,
      WAIT_MS,
      'the first reaction refused once',
    )
    await waitFor(() => ((nextAt(engine, 'outbox', first) ?? 0) - Date.now() > 1_500 ? true : undefined), WAIT_MS, 'a backoff')
    valueOf(await reactToMessage(engine.registry, refOf(two), 'tada', true))
    await sleep(200)

    expect(await cpuOver(2_000)).toBeLessThan(IDLE_CPU_BUDGET_PERCENT)
    expect(actionRows(engine)).toHaveLength(2)
  })
})
