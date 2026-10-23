import { describe, expect } from 'bun:test'
import { itLive } from '@juno/testing/effect'
import { Cause, Effect, Fiber, Queue, Stream } from 'effect'
import { isMessagePosted } from '@juno/slack-schema'
import { SlackSocket, type SocketEvent } from '../src/index.ts'
import { CHANNEL, clientLayer, collect, eventually, fakeSlack, takeUntil } from './helpers.ts'

const isConnected = (event: SocketEvent): event is Extract<SocketEvent, { _tag: 'Connected' }> => event._tag === 'Connected'
const isDisconnected = (event: SocketEvent): event is Extract<SocketEvent, { _tag: 'Disconnected' }> => event._tag === 'Disconnected'
const isPostedMessage = (event: SocketEvent): event is Extract<SocketEvent, { _tag: 'Frame' }> =>
  event._tag === 'Frame' && isMessagePosted(event.frame)

describe('SlackSocket', () => {
  itLive('receives hello and an injected message event', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const program = Effect.gen(function* () {
        const socket = yield* SlackSocket
        const { queue } = yield* collect(yield* socket.events)

        const hello = yield* takeUntil(queue, (event: SocketEvent) => event._tag === 'Frame' && event.frame.type === 'hello')
        expect(hello._tag).toBe('Frame')
        yield* takeUntil(queue, isConnected)

        fake.injectMessage({ channel: CHANNEL, text: 'hello from the fake' })
        const posted = yield* takeUntil(queue, isPostedMessage)
        if (isMessagePosted(posted.frame)) {
          expect(posted.frame.channel).toBe(CHANNEL)
          expect(posted.frame.text).toBe('hello from the fake')
        }

        // Pings go out and pongs come back as frames.
        yield* takeUntil(queue, (event: SocketEvent) => event._tag === 'Frame' && event.frame.type === 'pong')
      })
      yield* program.pipe(Effect.provide(clientLayer(fake)), Effect.scoped)
      yield* eventually(() => fake.socketCount() === 0)
    }),
  )

  itLive('reconnects after the fake drops the socket and keeps receiving', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const program = Effect.gen(function* () {
        const socket = yield* SlackSocket
        const { queue } = yield* collect(yield* socket.events)
        yield* takeUntil(queue, isConnected)
        // The server hands out a reconnect_url shortly after hello (and again every 30 s); the next connect uses it.
        yield* takeUntil(queue, (event: SocketEvent) => event._tag === 'Frame' && event.frame.type === 'reconnect_url')

        fake.dropSocket()
        const down = yield* takeUntil(queue, isDisconnected)
        expect(down.retryInMillis).toBeLessThanOrEqual(200)
        const back = yield* takeUntil(queue, isConnected)
        expect(back.fast).toBe(true)

        fake.injectMessage({ channel: CHANNEL, text: 'after reconnect' })
        const posted = yield* takeUntil(queue, isPostedMessage)
        if (isMessagePosted(posted.frame)) expect(posted.frame.text).toBe('after reconnect')
      })
      yield* program.pipe(Effect.provide(clientLayer(fake)), Effect.scoped)
      // One URL from the API; the reconnect used the reconnect_url.
      expect(fake.callCount('client.getWebSocketURL')).toBe(1)
    }),
  )

  itLive('sends at most one tickle per spacing, across reconnects', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const tickles = () => fake.received.filter((frame) => frame.type === 'tickle')
      const program = Effect.gen(function* () {
        const socket = yield* SlackSocket
        const { queue } = yield* collect(yield* socket.events)
        yield* takeUntil(queue, isConnected)
        expect(yield* socket.tickle('polling')).toBe(true)
        expect(yield* socket.tickle('polling')).toBe(false)
        yield* eventually(() => tickles().length === 1)
        expect(tickles()[0]?.reason).toBe('polling')

        // A new connection does not reset the spacing.
        fake.dropSocket()
        yield* takeUntil(queue, isConnected)
        expect(yield* socket.tickle('polling')).toBe(false)
        yield* Effect.sleep(1_500)
        expect(yield* socket.tickle('polling')).toBe(true)
        yield* eventually(() => tickles().length === 2)
        expect(fake.selfPresence()).toBe('active')
      })
      yield* program.pipe(Effect.provide(clientLayer(fake, { socket: { tickleSpacingMillis: 1_500 } })), Effect.scoped)
      // The socket closed: Slack shows the user away.
      yield* eventually(() => fake.selfPresence() === 'away')
    }),
  )

  itLive('passes unknown frames through and skips known types with a bad shape', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const program = Effect.gen(function* () {
        const socket = yield* SlackSocket
        const { queue } = yield* collect(yield* socket.events)
        yield* takeUntil(queue, isConnected)
        fake.emitFrame({ type: 'reaction_added', user: 'U0MAYA' })
        fake.emitFrame({ type: 'canvas_updated', canvas: 'F1' })
        const unknown = yield* takeUntil(queue, (event: SocketEvent) => event._tag === 'Frame' && event.frame.type === 'unknown')
        if (unknown._tag === 'Frame' && unknown.frame.type === 'unknown') expect(unknown.frame.raw).toStrictEqual({ type: 'canvas_updated', canvas: 'F1' })
      })
      yield* program.pipe(Effect.provide(clientLayer(fake)), Effect.scoped)
    }),
  )

  itLive('session expiry ends the stream with SlackAuthRequired', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const program = Effect.gen(function* () {
        const socket = yield* SlackSocket
        const { queue, fiber } = yield* collect(yield* socket.events)
        yield* takeUntil(queue, isConnected)

        fake.expireSession()
        const exit = yield* Fiber.await(fiber)
        expect(exit._tag).toBe('Failure')
        if (exit._tag === 'Failure') {
          const error = Cause.findErrorOption(exit.cause)
          expect(error._tag === 'Some' ? error.value._tag : undefined).toBe('SlackAuthRequired')
        }
        const frames = yield* Queue.takeAll(queue)
        expect(frames.some((event) => event._tag === 'Frame' && event.frame.type === 'user_session_expiration')).toBe(true)
      })
      yield* program.pipe(Effect.provide(clientLayer(fake)), Effect.scoped)
    }),
  )

  itLive('an expired session at connect time fails the stream without a socket', () =>
    Effect.gen(function* () {
      const fake = yield* fakeSlack
      const credentials = fake.signIn()
      fake.expireSession()
      const result = yield* SlackSocket.use((socket) => Effect.flatMap(socket.events, Stream.runCollect)).pipe(
        Effect.provide(clientLayer(fake, {}, credentials)),
        Effect.scoped,
        Effect.flip,
      )
      expect(result._tag).toBe('SlackAuthRequired')
      expect(fake.socketCount()).toBe(0)
    }),
  )
})
