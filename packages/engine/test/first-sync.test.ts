// The first sync with the app's request pacing scaled down ten times, every method alike, so it runs in seconds
// with the real ratios between methods, on a seed shaped like a real workspace (docs/performance.md, "First sync"). History is the longest step on a real workspace, so everything with a clock of its own runs
// beside it: thread previews read replies while history reads channels, and user groups and emoji load beside
// the boot rather than after it. A 429 on history in the middle of it delays history only by its Retry-After.
import { largeSeed } from '@juno/fake-slack'
import { afterEach, describe, expect, it } from 'vitest'
import { startTestEngine, waitFor, type RunningEngine } from './harness'
import { apiCalls, bootedEngine } from './scenario'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** Pacing ten times faster than the app's: history and replies 150 ms apart, search 600 ms, the rest 300 ms. */
const SCALE = 10
/** Slack's Retry-After is whole seconds; one is still several history spacings. */
const RETRY_AFTER = 1
/** Live calls took about 450 ms (performance.md, "First sync timeline"), scaled with the pacing. */
const LATENCY = 45
/** Ten conversations active in the window and 40 threads: history, previews and emoji all have work. */
const SEED = () => largeSeed({ topics: 40, messages: 600, users: 80, days: 7, channels: { public: 6, private: 1, dms: 2, mpims: 1 } })

describe('first sync, paced', () => {
  it('reads thread previews and emoji beside history', async () => {
    const engine = await bootedEngine(
      engines,
      {
        paced: SCALE,
        initial: (fake) => fake.signIn(),
        fakeOptions: { seed: SEED(), latencyMillis: LATENCY },
      },
      30_000,
    )
    const history = apiCalls(engine, 'conversations.history').filter((call) => call.args['_x_reason'] === 'history')
    const previews = apiCalls(engine, 'conversations.replies').filter((call) => call.args['_x_reason'] === 'thread-preview')
    const emoji = engine.fake.calls.filter((call) => call.method === 'emojis/list')
    const lastHistory = Math.max(...history.map((call) => call.at))
    expect(history.length).toBeGreaterThanOrEqual(8)
    expect(previews.length).toBeGreaterThanOrEqual(4)
    // Beside history, not after it: the first preview comes while history is still reading.
    expect(Math.min(...previews.map((call) => call.at))).toBeLessThan(lastHistory)
    // Emoji load beside the boot, not after it.
    expect(emoji.length).toBeGreaterThan(0)
    expect(Math.min(...emoji.map((call) => call.at))).toBeLessThan(lastHistory)
  }, 60_000)

  it('a 429 on history waits out its Retry-After, and the boot still completes', async () => {
    const engine = await startTestEngine({ paced: SCALE, initial: (fake) => fake.signIn(), fakeOptions: { seed: SEED(), latencyMillis: LATENCY } })
    engines.push(engine)
    await engine.status('ready')
    // Once history has read a few channels, so the previews have roots to read.
    await waitFor(() => (apiCalls(engine, 'conversations.history').length >= 3 ? true : undefined), 30_000, 'three history pages')
    engine.fake.force429({ method: 'conversations.history', retryAfter: RETRY_AFTER, times: 1 })
    await engine.phase('live', 30_000)
    await engine.syncIdle()
    const history = apiCalls(engine, 'conversations.history')
    const limited = history.find((call) => call.status === 429)
    expect(limited).toBeDefined()
    // History waited out its Retry-After.
    const next = history.find((call) => call.at > limited!.at)
    expect(next).toBeDefined()
    expect(next!.at - limited!.at).toBeGreaterThanOrEqual(RETRY_AFTER * 1000 - 50)
    // The boot still read every preview it would have.
    const previews = apiCalls(engine, 'conversations.replies').filter((call) => call.args['_x_reason'] === 'thread-preview')
    expect(previews.length).toBeGreaterThanOrEqual(4)
    // Every active conversation's history was still read.
    const channels = new Set(history.filter((call) => call.status === 200 && call.args['_x_reason'] === 'history').map((call) => call.args['channel']))
    expect(channels.size).toBeGreaterThanOrEqual(8)
  }, 60_000)
})
