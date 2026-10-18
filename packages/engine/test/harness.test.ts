import { afterEach, expect, it } from 'vitest'
import { startTestEngine, waitFor, type RunningEngine } from './harness'
import { topicsPin } from '@juno/contract'
import { runCommand } from '@juno/state'
import { apiCalls, valueOf } from './scenario'

let engine: RunningEngine | undefined
afterEach(async () => {
  await engine?.stop()
  engine = undefined
})

it('waits beyond live for the follow pass, and polls async conditions until they hold', async () => {
  engine = await startTestEngine({
    initial: (fake) => {
      fake.holdNext({ method: 'subscriptions.thread.getView' })
      return fake.signIn()
    },
  })
  const running = engine
  // Release the two boot pages, then hold the first page of the background pass.
  for (let page = 0; page < 2; page++) {
    await waitFor(() => (running.fake.heldCount({ method: 'subscriptions.thread.getView' }) === 1 ? true : undefined))
    running.fake.release({ method: 'subscriptions.thread.getView' })
    running.fake.holdNext({ method: 'subscriptions.thread.getView' })
  }
  await running.phase('live')
  await waitFor(() => (running.fake.heldCount({ method: 'subscriptions.thread.getView' }) === 1 ? true : undefined))
  let idle = false
  const completed = running.syncIdle().then(() => { idle = true })
  let reads = 0
  const rows = await waitFor(async () => {
    const list = await running.rows()
    reads += 1
    return reads > 1 && list.length >= 20 ? list : undefined
  })
  expect(rows.length).toBeGreaterThanOrEqual(20)
  expect(idle).toBe(false)
  running.fake.release({ method: 'subscriptions.thread.getView' })
  await completed
  expect(apiCalls(running, 'subscriptions.thread.getView')).toHaveLength(4)
})

it('starts each engine from an empty schema after the previous engine writes and closes', async () => {
  engine = await startTestEngine({ initial: (fake) => fake.signIn() })
  await engine.phase('live')
  await engine.syncIdle()
  valueOf(await runCommand(engine.registry, topicsPin, { id: 'm:C0ENG' }))
  await engine.rowsUntil((rows) => rows.some((row) => row.id === 'm:C0ENG' && row.pinned), 'first engine pinned')
  const first = engine
  await first.stop()
  engine = undefined

  engine = await startTestEngine({ initial: (fake) => fake.signIn() })
  await engine.phase('live')
  await engine.syncIdle()
  const rows = await engine.rowsUntil((list) => list.some((row) => row.id === 'm:C0ENG'), 'second engine synced')
  expect(rows.find((row) => row.id === 'm:C0ENG')?.pinned, 'second engine starts without the first pin').toBe(false)
  expect(engine.userData).not.toBe(first.userData)
  expect(apiCalls(engine, 'conversations.history').length, 'second engine still performs a cold sync').toBeGreaterThan(0)
})
