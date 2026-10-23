import { describe, expect } from 'bun:test'
import { itEffect, itLive } from '@juno/testing/effect'
import { Effect, Fiber } from 'effect'
import { RequestQueue, SlackApi, SlackEdge } from '../src/index.ts'
import { CHANNEL, clientLayer, eventually, fakeSlack, SELF } from './helpers.ts'

describe('SlackApi.call', () => {
  itEffect('round-trips a call as multipart with the token first and decodes the answer', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const boot = yield* SlackApi.use((api) => api.call('client.userBoot', { return_all_relevant_mpdms: true }, { reason: 'test' })).pipe(
        Effect.provide(clientLayer(fake)),
      )
      expect(boot.self.id).toBe(SELF)
      expect(boot.channels.some((channel) => channel.id === CHANNEL)).toBe(true)

      const [call] = fake.calls
      expect(call?.method).toBe('client.userBoot')
      expect(call?.args['return_all_relevant_mpdms']).toBe('true')
      expect(call?.args['_x_reason']).toBe('test')
      expect(call?.args['_x_mode']).toBe('online')
      expect(Object.keys(call?.args ?? {})[0]).toBe('token')
    }),
  )

  itEffect('an ok:false answer with a plain error is a SlackRejected', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const result = yield* SlackApi.use((api) => api.call('conversations.history', { channel: 'C0NOPE' })).pipe(
        Effect.provide(clientLayer(fake)),
        Effect.flip,
      )
      expect(result._tag).toBe('SlackRejected')
      if (result._tag === 'SlackRejected') expect(result.error).toBe('channel_not_found')
      expect(fake.callCount()).toBe(1)
    }),
  )

  itEffect('a fatal auth error surfaces as SlackAuthRequired and is not retried', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const credentials = fake.signIn()
      fake.expireSession()
      const result = yield* SlackApi.use((api) => api.call('client.counts', {})).pipe(
        Effect.provide(clientLayer(fake, {}, credentials)),
        Effect.flip,
      )
      expect(result._tag).toBe('SlackAuthRequired')
      if (result._tag === 'SlackAuthRequired') expect(result.error).toBe('invalid_auth')
      expect(fake.callCount()).toBe(1)
    }),
  )

  itLive('a 429 is retried after Retry-After and then succeeds', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      fake.force429({ method: 'conversations.history', retryAfter: 1, times: 1 })
      const started = Date.now()
      const history = yield* SlackApi.use((api) => api.call('conversations.history', { channel: CHANNEL, limit: 2 })).pipe(
        Effect.provide(clientLayer(fake)),
      )
      expect(history.messages.length).toBeGreaterThanOrEqual(1)
      expect(Date.now() - started).toBeGreaterThanOrEqual(900)
      const [first, second] = fake.calls
      expect(first?.status).toBe(429)
      expect(second?.status).toBe(200)
      expect(fake.callCount('conversations.history')).toBe(2)
    }),
  )

  itLive('a lost answer is retried, so a post can land twice; a single attempt posts once', () =>
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
      expect(posted('3f0c8a51-0000-4000-8000-000000000001')).toBe(2)

      fake.loseResponse({ method: 'chat.postMessage' })
      const once = yield* post('3f0c8a51-0000-4000-8000-000000000002', true)
      expect(once._tag === 'Failure' && once.failure._tag === 'SlackTransportError').toBe(true)
      expect(posted('3f0c8a51-0000-4000-8000-000000000002')).toBe(1)
    }),
  )

  itLive('a paused method does not hold the interactive lane: it fails fast with SlackRateLimited', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      fake.force429({ method: 'conversations.history', retryAfter: 30, times: 1 })
      const layer = clientLayer(fake)
      const started = Date.now()
      const result = yield* SlackApi.use((api) => api.call('conversations.history', { channel: CHANNEL })).pipe(
        Effect.provide(layer),
        Effect.flip,
      )
      expect(result._tag).toBe('SlackRateLimited')
      if (result._tag === 'SlackRateLimited') expect(result.retryAfterMillis).toBeGreaterThanOrEqual(25_000)
      expect(Date.now() - started).toBeLessThan(2_000)
      expect(fake.callCount('conversations.history')).toBe(1)
    }),
  )

  itLive('a 429 on one method pauses only that method', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      fake.force429({ method: 'conversations.history', retryAfter: 30, times: 1 })
      const program = Effect.gen(function* () {
        const api = yield* SlackApi
        yield* api.call('conversations.history', { channel: CHANNEL }).pipe(Effect.ignore)
        const counts = yield* api.call('client.counts', {})
        expect(counts.ok).toBe(true)
        const again = yield* api.call('conversations.history', { channel: CHANNEL }).pipe(Effect.flip)
        expect(again._tag).toBe('SlackRateLimited')
        expect(fake.callCount('conversations.history')).toBe(1)
      })
      yield* program.pipe(Effect.provide(clientLayer(fake)))
    }),
  )

  itLive('queued calls respect a new Retry-After after waiting for a permit', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const program = Effect.gen(function* () {
        const api = yield* SlackApi
        const queue = yield* RequestQueue
        const history = api.call('conversations.history', { channel: CHANNEL, limit: 1 }, { lane: 'background' })
        yield* history
        const waiting = yield* Effect.forkScoped(history)
        yield* api.call('client.counts', {}, { lane: 'interactive' })
        // The history call is already waiting for its slot when the pause arrives.
        const pausedAt = Date.now()
        yield* queue.pause('conversations.history', 1_000)
        yield* Fiber.join(waiting)
        yield* history
        const calls = fake.calls.filter((call) => call.method === 'conversations.history')
        expect(calls).toHaveLength(3)
        expect(calls[1]!.at - pausedAt).toBeGreaterThanOrEqual(950)
        // A 429 doubles the method interval (1 s here) until the quiet period.
        expect(calls[2]!.at - calls[1]!.at).toBeGreaterThanOrEqual(1_900)
        const counts = fake.calls.find((call) => call.method === 'client.counts')!
        expect(counts.at).toBeLessThan(calls[1]!.at)
        expect(fake.calls.every((call) => call.status === 200)).toBe(true)
      })
      // History is spaced 1 s apart, not 1.5 s, to keep the waits short.
      yield* program.pipe(Effect.provide(clientLayer(fake, { lanes: { backgroundConcurrency: 1, backgroundMinIntervalMillis: 1_000 } })))
    }),
    10_000,
  )

  itEffect('a flood of background calls does not starve the interactive lane', () =>
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
        expect(counts.ok).toBe(true)
        expect(fake.callCount('conversations.history')).toBeLessThanOrEqual(2)
        yield* Fiber.interrupt(flood)
      })
      yield* program.pipe(Effect.provide(clientLayer(fake)))
    }),
  )
})

describe('SlackEdge', () => {
  itEffect('fetches the edge URL once and queries users/info with JSON', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const program = Effect.gen(function* () {
        const edge = yield* SlackEdge
        const first = yield* edge.usersInfo([SELF, 'U0MAYA', 'U0NOPE'])
        expect(first.results.map((user) => user.id).toSorted()).toStrictEqual([SELF, 'U0MAYA'].toSorted())
        expect(first.failed_ids).toStrictEqual(['U0NOPE'])
        const second = yield* edge.usersInfo(['U0MAYA'])
        expect(second.results.length).toBe(1)
      })
      // Three background calls in a row; no spacing so the virtual clock need not move.
      yield* program.pipe(Effect.provide(clientLayer(fake, { lanes: { backgroundMinIntervalMillis: 0 } })))
      expect(fake.callCount('api.getFlannelHttpUrl')).toBe(1)
      expect(fake.calls.filter((call) => call.kind === 'edge').length).toBe(2)
    }),
  )
})
