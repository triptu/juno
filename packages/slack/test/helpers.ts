/**
 * A fake Slack per test and the client layer pointed at it. The fake listens
 * on 127.0.0.1, so the config allows that host for the socket and shortens
 * every timer that would otherwise make a test slow.
 */
import { Cause, Effect, Layer, Queue, Stream } from 'effect'
import { startFakeSlack, type FakeSlack } from '@juno/fake-slack'
import {
  HttpTransport,
  SlackClient,
  SlackSession,
  slackConfigLayer,
  SocketHandshake,
  type SlackConfigOverrides,
} from '../src/index.ts'

export const SELF = 'U0TUSHAR'
export const CHANNEL = 'C0ENG'

/** A running fake, closed when the scope ends. */
export const fakeSlack = Effect.acquireRelease(
  Effect.promise(() => startFakeSlack()),
  (fake) => Effect.promise(() => fake.close()),
)

export const testConfig = (overrides: SlackConfigOverrides = {}): SlackConfigOverrides => ({
  transientBackoffMillis: 10,
  transientBackoffCapMillis: 50,
  ...overrides,
  lanes: { ...overrides.lanes },
  socket: {
    allowedHosts: ['127.0.0.1', 'localhost'],
    backoffBaseMillis: 20,
    backoffCapMillis: 200,
    helloTimeoutMillis: 2_000,
    pingIntervalMillis: 50,
    pongTimeoutMillis: 300,
    ...overrides.socket,
  },
})

/** The whole client against `fake`, using the fake's default session unless `credentials` says otherwise. */
export const clientLayer = (fake: FakeSlack, overrides: SlackConfigOverrides = {}, credentials = fake.credentials()) =>
  SlackClient.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        SlackSession.layer({ teamId: credentials.teamId, userId: credentials.userId, workspaceUrl: credentials.url, token: credentials.token }),
        HttpTransport.nodeFetch({ headers: { cookie: `d=${credentials.cookie}` } }),
        SocketHandshake.fixed({ cookie: `d=${credentials.cookie}` }),
        slackConfigLayer(testConfig(overrides)),
      ),
    ),
  )

/** Runs a stream in the background and hands back a queue of its elements and its end. */
export const collect = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<A>()
    const fiber = yield* Effect.forkScoped(Stream.runForEach(stream, (a) => Queue.offer(queue, a)))
    return { queue, fiber }
  })

/** Takes from `queue` until `predicate` matches, giving up after `timeoutMillis` of real time. */
export function takeUntil<A, B extends A>(queue: Queue.Queue<A>, predicate: (a: A) => a is B, timeoutMillis?: number): Effect.Effect<B, Cause.TimeoutError>
export function takeUntil<A>(queue: Queue.Queue<A>, predicate: (a: A) => boolean, timeoutMillis?: number): Effect.Effect<A, Cause.TimeoutError>
export function takeUntil<A>(queue: Queue.Queue<A>, predicate: (a: A) => boolean, timeoutMillis = 3_000): Effect.Effect<A, Cause.TimeoutError> {
  return Effect.gen(function* () {
    while (true) {
      const item = yield* Queue.take(queue)
      if (predicate(item)) return item
    }
  }).pipe(Effect.timeout(timeoutMillis))
}

/** Polls `check` every few milliseconds of real time until it is true. Independent of the Effect clock, so it works under the TestClock. */
export const eventually = (check: () => boolean, timeoutMillis = 3_000) =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMillis
    while (!check()) {
      if (Date.now() > deadline) return yield* Effect.die(new Error('eventually: condition not met in time'))
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 5)))
    }
  })
