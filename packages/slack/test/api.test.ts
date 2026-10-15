import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { RequestQueue, SlackApi, SlackEdge } from '../src/index.ts'
import { CHANNEL, clientLayer, eventually, fakeSlack, SELF } from './helpers.ts'

describe('SlackApi.call', () => {
  it.effect('round-trips a call as multipart with the token first and decodes the answer', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const boot = yield* SlackApi.use((api) => api.call('client.userBoot', { return_all_relevant_mpdms: true }, { reason: 'test' })).pipe(
        Effect.provide(clientLayer(fake)),
      )
      assert.strictEqual(boot.self.id, SELF)
      assert.isTrue(boot.channels.some((channel) => channel.id === CHANNEL))

      const [call] = fake.calls
      assert.strictEqual(call?.method, 'client.userBoot')
      assert.strictEqual(call?.args['return_all_relevant_mpdms'], 'true')
      assert.strictEqual(call?.args['_x_reason'], 'test')
      assert.strictEqual(call?.args['_x_mode'], 'online')
      assert.strictEqual(Object.keys(call?.args ?? {})[0], 'token')
    }),
  )

  it.effect('an ok:false answer with a plain error is a SlackRejected', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const result = yield* SlackApi.use((api) => api.call('conversations.history', { channel: 'C0NOPE' })).pipe(
        Effect.provide(clientLayer(fake)),
        Effect.flip,
      )
      assert.strictEqual(result._tag, 'SlackRejected')
      if (result._tag === 'SlackRejected') assert.strictEqual(result.error, 'channel_not_found')
      assert.strictEqual(fake.callCount(), 1)
    }),
  )

  it.effect('a fatal auth error surfaces as SlackAuthRequired and is not retried', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const credentials = fake.signIn()
      fake.expireSession()
      const result = yield* SlackApi.use((api) => api.call('client.counts', {})).pipe(
        Effect.provide(clientLayer(fake, {}, credentials)),
        Effect.flip,
      )
      assert.strictEqual(result._tag, 'SlackAuthRequired')
      if (result._tag === 'SlackAuthRequired') assert.strictEqual(result.error, 'invalid_auth')
      assert.strictEqual(fake.callCount(), 1)
    }),
  )

  it.live('a 429 is retried after Retry-After and then succeeds', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      fake.force429({ method: 'conversations.history', retryAfter: 1, times: 1 })
      const started = Date.now()
      const history = yield* SlackApi.use((api) => api.call('conversations.history', { channel: CHANNEL, limit: 2 })).pipe(
        Effect.provide(clientLayer(fake)),
      )
      assert.isAtLeast(history.messages.length, 1)
      assert.isAtLeast(Date.now() - started, 900)
      const [first, second] = fake.calls
      assert.strictEqual(first?.status, 429)
      assert.strictEqual(second?.status, 200)
      assert.strictEqual(fake.callCount('conversations.history'), 2)
    }),
  )

  it.live('a lost answer is retried, so a post can land twice; a single attempt posts once', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const layer = clientLayer(fake)
      const post = (clientMsgId: string, singleAttempt: boolean) =>
        SlackApi.use((api) =>
          api.call('chat.postMessage', { channel: CHANNEL, text: clientMsgId, client_msg_id: clientMsgId }, { lane: 'send', singleAttempt }),
        ).pipe(Effect.provide(layer), Effect.result)
      const posted = (clientMsgId: string) => fake.messages(CHANNEL).filter((m) => m.client_msg_id === clientMsgId).length

      fake.loseResponse({ method: 'chat.postMessage' })
      yield* post('3f0c8a51-0000-4000-8000-000000000001', false)
      assert.strictEqual(posted('3f0c8a51-0000-4000-8000-000000000001'), 2)

      fake.loseResponse({ method: 'chat.postMessage' })
      const once = yield* post('3f0c8a51-0000-4000-8000-000000000002', true)
      assert.isTrue(once._tag === 'Failure' && once.failure._tag === 'SlackTransportError')
      assert.strictEqual(posted('3f0c8a51-0000-4000-8000-000000000002'), 1)
    }),
  )

  it.live('a paused method does not hold the interactive lane: it fails fast with SlackRateLimited', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      fake.force429({ method: 'conversations.history', retryAfter: 30, times: 1 })
      const layer = clientLayer(fake)
      const started = Date.now()
      const result = yield* SlackApi.use((api) => api.call('conversations.history', { channel: CHANNEL })).pipe(
        Effect.provide(layer),
        Effect.flip,
      )
      assert.strictEqual(result._tag, 'SlackRateLimited')
      if (result._tag === 'SlackRateLimited') assert.isAtLeast(result.retryAfterMillis, 25_000)
      assert.isBelow(Date.now() - started, 2_000)
      assert.strictEqual(fake.callCount('conversations.history'), 1)
    }),
  )

  it.live('a 429 on one method pauses only that method', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      fake.force429({ method: 'conversations.history', retryAfter: 30, times: 1 })
      const program = Effect.gen(function* () {
        const api = yield* SlackApi
        const queue = yield* RequestQueue
        yield* api.call('conversations.history', { channel: CHANNEL }).pipe(Effect.ignore)
        assert.isDefined(yield* queue.pausedUntil('conversations.history'))
        assert.isUndefined(yield* queue.pausedUntil('client.counts'))
        const counts = yield* api.call('client.counts', {})
        assert.isTrue(counts.ok)
      })
      yield* program.pipe(Effect.provide(clientLayer(fake)))
    }),
  )

  it.live('background methods have independent tiers and queued calls respect a new Retry-After', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const program = Effect.gen(function* () {
        const api = yield* SlackApi
        const queue = yield* RequestQueue
        const history = api.call('conversations.history', { channel: CHANNEL, limit: 1 }, { lane: 'background' })
        yield* history
        const waiting = yield* Effect.forkScoped(history)
        yield* api.call('client.counts', {}, { lane: 'background' })
        // The history call is already waiting for its slot when the pause arrives.
        const pausedAt = Date.now()
        yield* queue.pause('conversations.history', 1_500)
        yield* Fiber.join(waiting)
        yield* history
        const calls = fake.calls.filter((call) => call.method === 'conversations.history')
        assert.lengthOf(calls, 3)
        assert.isAtLeast(calls[1]!.at - pausedAt, 1_450)
        // A 429 doubles the Tier 3 interval for this session.
        assert.isAtLeast(calls[2]!.at - calls[1]!.at, 2_350)
        const counts = fake.calls.find((call) => call.method === 'client.counts')!
        assert.isBelow(counts.at, calls[1]!.at)
        assert.isTrue(fake.calls.every((call) => call.status === 200))
      })
      yield* program.pipe(Effect.provide(clientLayer(fake, { lanes: { backgroundConcurrency: 1 } })))
    }),
    10_000,
  )

  it.effect('a flood of background calls does not starve the interactive lane', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const program = Effect.gen(function* () {
        const api = yield* SlackApi
        // Under the TestClock the background spacing never elapses, so at most
        // `backgroundConcurrency` of these ever reach the fake.
        const flood = yield* Effect.forkScoped(
          Effect.forEach(Array.from({ length: 20 }, (_, i) => i), () => api.call('conversations.history', { channel: CHANNEL, limit: 1 }, { lane: 'background' }), {
            concurrency: 'unbounded',
          }),
        )
        yield* eventually(() => fake.callCount('conversations.history') >= 1)
        const counts = yield* api.call('client.counts', {}, { lane: 'interactive' })
        assert.isTrue(counts.ok)
        assert.isAtMost(fake.callCount('conversations.history'), 2)
        yield* Fiber.interrupt(flood)
      })
      yield* program.pipe(Effect.provide(clientLayer(fake)))
    }),
  )
})

describe('SlackEdge', () => {
  it.effect('fetches the edge URL once and queries users/info with JSON', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const program = Effect.gen(function* () {
        const edge = yield* SlackEdge
        const first = yield* edge.usersInfo([SELF, 'U0MAYA', 'U0NOPE'])
        assert.deepStrictEqual(first.results.map((user) => user.id).toSorted(), [SELF, 'U0MAYA'].toSorted())
        assert.deepStrictEqual(first.failed_ids, ['U0NOPE'])
        const second = yield* edge.usersInfo(['U0MAYA'])
        assert.strictEqual(second.results.length, 1)
      })
      // Three background calls in a row; no spacing so the virtual clock need not move.
      yield* program.pipe(Effect.provide(clientLayer(fake, { lanes: { backgroundMinIntervalMillis: 0 } })))
      assert.strictEqual(fake.callCount('api.getFlannelHttpUrl'), 1)
      assert.strictEqual(fake.calls.filter((call) => call.kind === 'edge').length, 2)
    }),
  )
})
