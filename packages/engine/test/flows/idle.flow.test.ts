// The engine sleeps when nothing is due (performance.md section 1, "Idle CPU").
// On 10-18 a "Juno Helper" sat at 100 % of a core: a send worker ran its pass
// again at once while a channel's first edit waited out a backoff and a second
// waited behind it. Under the test clock, this counts the passes each worker
// starts: none at rest, and about one per retry while edits back off.
// `idle-cpu.spec.ts` measures real processes on the Mac.
import { expect, it } from 'bun:test'
import { editMessage } from '@juno/state'
import type { WorkName } from '../../src/workControl'
import { productionTiming } from '../../src/config'
import { controlledClock } from '../controlledClock'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { quiet, readDb, valueOf } from '../scenario'
import { MAIN, outboxScenario, refOf, sent } from '../outboxScenario'

const { booted, watch, stop } = outboxScenario()

// Scheduled work (Automated's hold check) may take a pass or two in ten minutes; a spin takes thousands.
const AT_REST = 4

const sum = (passes: Record<string, number>) => Object.values(passes).reduce((total, count) => total + count, 0)

/** Passes started since `before`, by worker, leaving out workers that ran none. */
function passesSince(engine: RunningEngine, before: ReadonlyMap<WorkName, number>): Record<string, number> {
  const ran: Record<string, number> = {}
  for (const [name, count] of engine.passes()) if (count > (before.get(name) ?? 0)) ran[name] = count - (before.get(name) ?? 0)
  return ran
}

it('starts no work pass at rest, and one action pass per retry while an edit backs off with another behind it', async () => {
  const time = await controlledClock()
  const engine = await booted({
    clock: time.clock,
    timing: { retryBaseMillis: productionTiming.retryBaseMillis, retryCapMillis: productionTiming.retryCapMillis, socketPingMillis: 86_400_000, socketPongTimeoutMillis: 86_400_000 },
  })
  // Steps of engine time, each followed by a moment of live time for the fake's answers.
  const pass = async (millis: number, step: number) => {
    for (let elapsed = 0; elapsed < millis; elapsed += step) {
      await time.advance(step)
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
  }
  try {
    const rows = watch(engine, MAIN)
    const first = await sent(engine, 'First draft', rows)
    const second = await sent(engine, 'Second draft', rows)
    await quiet(engine)
    await time.freeze()

    const atRest = engine.passes()
    await pass(10 * 60_000, 1_000)
    expect(sum(passesSince(engine, atRest)), 'passes in ten idle minutes').toBeLessThanOrEqual(AT_REST)

    // An error the client does not retry itself, so only the outbox backoff waits.
    engine.fake.forceError({ method: 'chat.update', error: 'request_timeout', times: 1_000 })
    valueOf(await editMessage(engine.registry, refOf(first), 'First edit'))
    valueOf(await editMessage(engine.registry, refOf(second), 'Second edit'))
    const attempts = () => readDb(engine, 'user.db', (db) => db.prepare(`SELECT max(attempts) AS n FROM outbox WHERE kind = 'edit'`).get() as { n: number | null })
    await waitFor(() => ((attempts().n ?? 0) >= 1 ? true : undefined), WAIT_MS, 'the first try')
    await engine.handle.commandIdle()
    const waiting = engine.passes()
    // The first retry is a second away; the second edit is due but behind it.
    await pass(900, 50)
    expect(passesSince(engine, waiting).action ?? 0, 'action passes while the first edit waits out its backoff').toBe(0)

    // Each edit fails after five tries, a backoff apart.
    await pass(60_000, 100)
    const unfailed = () => readDb(engine, 'user.db', (db) => db.prepare(`SELECT count(*) AS n FROM outbox WHERE kind = 'edit' AND json_extract(payload_json, '$.failed') IS NULL`).get() as { n: number })
    await waitFor(() => (unfailed().n === 0 ? true : undefined), WAIT_MS, 'both edits given up')
    expect(passesSince(engine, waiting).action ?? 0, 'action passes for ten tries').toBeLessThanOrEqual(14)

    const afterFailure = engine.passes()
    await pass(10 * 60_000, 1_000)
    expect(sum(passesSince(engine, afterFailure)), 'passes in ten idle minutes after the failures').toBeLessThanOrEqual(AT_REST)
  } finally {
    await stop(engine)
    await time.close()
  }
}, 60_000)
