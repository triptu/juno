// An edit waiting to retry must not keep the engine busy (performance.md section 1,
// "Idle CPU after sync"): with production backoff, the channel's first edit waits out
// its retry and a second edit waits behind it, and the engine sleeps meanwhile.
import { expect, it } from 'bun:test'
import { editMessage } from '@juno/state'
import { productionTiming } from '../../src/config'
import { waitFor } from '../harness'
import { readDb, valueOf } from '../scenario'
import { actionRows, booted, MAIN, refOf, sent, stopEnginesAfterEach, watch } from '../actionScenario'

stopEnginesAfterEach()

it('stays idle while the channel’s first edit waits to retry and a second waits behind it [production timing]', async () => {
  const engine = await booted({ timing: { retryBaseMillis: productionTiming.retryBaseMillis, retryCapMillis: productionTiming.retryCapMillis, actionDeadlineMillis: productionTiming.actionDeadlineMillis } })
  const rows = watch(engine, MAIN)
  const first = await sent(engine, 'First draft', rows)
  const second = await sent(engine, 'Second draft', rows)
  engine.fake.forceError({ method: 'chat.update', times: 1000 })
  valueOf(await editMessage(engine.registry, refOf(first), 'First edit'))
  valueOf(await editMessage(engine.registry, refOf(second), 'Second edit'))
  const attempts = () => readDb(engine, 'user.db', (db) => db.prepare(`SELECT max(attempts) AS n FROM outbox WHERE kind = 'edit'`).get() as { n: number })
  // The second failure puts the first row off for two seconds.
  await waitFor(() => (attempts().n >= 2 ? true : undefined), 30_000, 'two tries')
  // The engine shares this process with the fake: a pass that keeps finding the row behind due shows as CPU.
  const before = process.cpuUsage()
  const started = performance.now()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const used = process.cpuUsage(before)
  expect((used.user + used.system) / 1000 / (performance.now() - started)).toBeLessThan(0.5)
  expect(actionRows(engine)).toHaveLength(2)
}, 60_000)
