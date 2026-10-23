// Slack's rate limits (architecture 5.1): a 429 pauses only its method until
// Retry-After, the engine says it was slowed down while a long pause holds,
// and the catch-up still converges once the pause ends.
import { afterEach, describe, expect, it } from 'bun:test'
import type { RunningEngine } from './harness'
import { apiCalls, bootedEngine, quiet } from './scenario'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

describe('rate limits', () => {
  it('a 429 storm during a catch-up waits out Retry-After per method, shows rate-limited, then converges', async () => {
    const engine = await bootedEngine(engines)
    await quiet(engine)
    engine.fake.goOffline()
    await engine.phase('offline')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Sent while the limits were tight.' })
    engine.fake.resetCalls()
    // The next call of history gets a 429 with a 6 s Retry-After, long enough to show rate-limited (over the
    // client's 5 s interactive wait). Each of the next two calls of counts gets one with 1 s, which is not shown.
    const retryAfter: Record<string, number> = { 'conversations.history': 6, 'client.counts': 1 }
    const times: Record<string, number> = { 'conversations.history': 1, 'client.counts': 2 }
    for (const method of Object.keys(retryAfter)) engine.fake.force429({ method, retryAfter: retryAfter[method]!, times: times[method]! })
    engine.fake.goOnline()

    const limited = await engine.phase('rate-limited', 30_000)
    expect(limited).toMatchObject({ _tag: 'rate-limited' })
    await engine.phase('live', 60_000)
    await engine.rowsUntil((rows) => rows.some((r) => r.preview.text === 'Sent while the limits were tight.'), 'the message from the gap')

    for (const method of ['conversations.history', 'client.counts']) {
      const calls = apiCalls(engine, method)
      const limitedCalls = calls.filter((call) => call.status === 429)
      expect<unknown>(limitedCalls.length, method).toBe(times[method])
      // Every call after a 429 of the same method waited out its Retry-After.
      for (const call of limitedCalls) {
        const next = calls.find((later) => later.at > call.at)
        expect(next, method).toBeDefined()
        expect(next!.at - call.at, method).toBeGreaterThanOrEqual(retryAfter[method]! * 1000 - 50)
      }
    }
  }, 120_000)
})
