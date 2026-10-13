import { afterEach, expect, it } from 'vitest'
import { startTestEngine, waitFor, type RunningEngine } from './harness'
import { apiCalls } from './scenario'

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
