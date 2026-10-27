// Slack's rate limits (architecture 5.1): a 429 pauses only its method until Retry-After, the engine
// says it was slowed down while a long pause holds, and the sync still converges once the pause ends.
// The waits are real, in fractions of a second, against a shorter interactive wait than the app's 5 s.
// Only lower bounds are checked, which load cannot break.
import { afterEach, describe, expect, it } from 'bun:test'
import { largeSeed } from '@juno/fake-slack'
import { startTestEngine, waitFor, type RunningEngine } from '../harness'
import { apiCalls, quiet } from '../scenario'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** The longest pause an interactive call waits out here; the app waits 5 s. */
const INTERACTIVE_WAIT = 250

/** Every call of `method` after one of its 429s came at least that 429's Retry-After later. */
function expectWaitedOut(engine: RunningEngine, method: string, retryAfterSeconds: number, times: number) {
  const calls = apiCalls(engine, method)
  const limited = calls.filter((call) => call.status === 429)
  expect<unknown>(limited.length, method).toBe(times)
  for (const call of limited) {
    const next = calls.find((later) => later.at > call.at)
    expect(next, method).toBeDefined()
    expect(next!.at - call.at, method).toBeGreaterThanOrEqual(retryAfterSeconds * 1000 - 50)
  }
}

describe('rate limits', () => {
  it('a 429 storm during a catch-up waits out Retry-After per method, shows rate-limited, then converges', async () => {
    const engine = await syncedEngine(engines, { timing: { slackInteractiveMaxWaitMillis: INTERACTIVE_WAIT } })
    engine.fake.goOffline()
    await engine.phase('offline')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Sent while the limits were tight.' })
    engine.fake.resetCalls()
    // History's next call gets a 0.5 s Retry-After, over the 250 ms interactive wait, so it shows as rate-limited.
    // Each of the next two calls of counts gets 0.1 s, and the thread view and search one each, which do not show.
    engine.fake.force429({ method: 'conversations.history', retryAfter: 0.5, times: 1 })
    engine.fake.force429({ method: 'client.counts', retryAfter: 0.1, times: 2 })
    engine.fake.force429({ method: 'subscriptions.thread.getView', retryAfter: 0.1, times: 1 })
    engine.fake.force429({ method: 'search.modules.messages', retryAfter: 0.1, times: 1 })
    engine.fake.goOnline()

    expect(await engine.phase('rate-limited', 30_000)).toMatchObject({ _tag: 'rate-limited' })
    await engine.phase('live', 60_000)
    await engine.rowsUntil((rows) => rows.some((r) => r.preview.text === 'Sent while the limits were tight.'), 'the message from the gap')
    expectWaitedOut(engine, 'conversations.history', 0.5, 1)
    expectWaitedOut(engine, 'client.counts', 0.1, 2)
    expectWaitedOut(engine, 'subscriptions.thread.getView', 0.1, 1)
    expectWaitedOut(engine, 'search.modules.messages', 0.1, 1)
  })

  it("a 429 on history during a paced first sync waits out its Retry-After, while previews go on, and the boot completes", async () => {
    // The app's pacing thirty times faster, with live latency scaled the same way (first-sync.flow.test.ts).
    const seed = largeSeed({ topics: 40, messages: 600, users: 80, days: 7, channels: { public: 6, private: 1, dms: 2, mpims: 1 } })
    const engine = await startTestEngine({ paced: 30, initial: (fake) => fake.signIn(), fakeOptions: { seed, latencyMillis: 15 } })
    engines.push(engine)
    await engine.status('ready')
    // Once history has read a few channels, so the previews have roots to read.
    await waitFor(() => (apiCalls(engine, 'conversations.history').length >= 3 ? true : undefined), 30_000, 'three history pages')
    engine.fake.force429({ method: 'conversations.history', retryAfter: 0.2, times: 1 })
    await engine.phase('live', 30_000)
    await quiet(engine)
    expectWaitedOut(engine, 'conversations.history', 0.2, 1)
    // The boot still read every preview and every active conversation's history.
    expect(apiCalls(engine, 'conversations.replies').filter((call) => call.args['_x_reason'] === 'thread-preview').length).toBeGreaterThanOrEqual(4)
    const channels = new Set(apiCalls(engine, 'conversations.history').filter((call) => call.status === 200 && call.args['_x_reason'] === 'history').map((call) => call.args['channel']))
    expect(channels.size).toBeGreaterThanOrEqual(8)
  })
})
