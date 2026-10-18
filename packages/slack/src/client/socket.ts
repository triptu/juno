/**
 * The real-time socket (architecture section 6, research section 4).
 *
 * `SlackSocket.events` starts the connection inside the caller's scope and
 * returns a stream of decoded frames plus two status events. The stream
 * runs for the life of the scope: the socket reconnects on its own after a
 * drop, a `goodbye`, an `error` frame or a missed pong, with exponential
 * backoff (1 s base, 60 s cap, jittered) that resets after a healthy
 * session. Only a fatal auth condition ends the stream, as a
 * `SlackAuthRequired` failure: `client.getWebSocketURL` answering with a
 * fatal auth error, or a `user_session_expiration` frame.
 *
 * Connect sequence: a fresh `reconnect_url` if one arrived within its TTL,
 * else `client.getWebSocketURL`; query params as the official client
 * (`token`, `sync_desync`, `slack_client=desktop`, `no_query_on_subscribe`,
 * `flannel=3`, `lazy_channels`, `batch_presence_aware`, `gateway_server`,
 * `slack_route`) but never `start_args` (see `resolveUrl`); the host is
 * checked against `config.socket.allowedHosts`; `ws` opens it with the
 * headers from `SocketHandshake` (cookie, origin, user agent) and an
 * optional proxy agent; the first frame must be `hello` within
 * `helloTimeoutMillis`. Then a `ping` goes out every `pingIntervalMillis`
 * and the socket is closed with 4998 after `pongTimeoutMillis` without a
 * `pong`.
 *
 * Frames are decoded with `RtmFrame`. Unknown types pass through as
 * `{ type: 'unknown', raw }`; a known type with an unexpected shape is
 * logged by type only and skipped. `pong`, `reconnect_url`, `error`,
 * `goodbye` and `user_session_expiration` are handled here and also
 * forwarded.
 *
 * `tickle` tells Slack the user is here, as the official client does while
 * the Mac is in use (research section 4, Presence). It is fire and forget
 * and paced here: at most one per `tickleSpacingMillis` (19 s), counted
 * across reconnects.
 */
import type { Agent } from 'node:http'
import { Cause, Clock, Context, Effect, Layer, Queue, Ref, Scope, Stream } from 'effect'
import { WebSocket } from 'ws'
import { decodeRtmFrame, type RtmFrame, type RtmOutgoingFrame } from '@juno/slack-schema'
import { SlackApi } from './api.ts'
import { SlackConfig, type SlackConfigShape } from './config.ts'
import { SlackAuthRequired } from './errors.ts'
import { SlackSession, slackRoute } from './session.ts'

/**
 * What the host must supply for the upgrade request (ADR 0007). In the app,
 * main serialises the `persist:slack` cookies and resolves the proxy; in
 * tests `SocketHandshake.fixed` carries the fake's cookie.
 */
export interface SocketHandshakeShape {
  /** Headers for the upgrade: `cookie`, `origin`, `user-agent`. Asked before every connect. */
  headers(url: string): Effect.Effect<Readonly<Record<string, string>>>
  /** `Set-Cookie` values from the upgrade response, to be written back into the session. */
  setCookies(cookies: ReadonlyArray<string>): Effect.Effect<void>
  /** A proxy agent for `ws`, when the system proxy applies to `url`. */
  agent(url: string): Effect.Effect<Agent | undefined>
}

export class SocketHandshake extends Context.Service<SocketHandshake, SocketHandshakeShape>()('juno/slack/SocketHandshake') {
  static readonly fixed = (options: {
    readonly cookie?: string
    readonly origin?: string
    readonly userAgent?: string
  }): Layer.Layer<SocketHandshake> =>
    Layer.succeed(SocketHandshake, {
      headers: () =>
        Effect.succeed({
          ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
          origin: options.origin ?? 'https://app.slack.com',
          ...(options.userAgent === undefined ? {} : { 'user-agent': options.userAgent }),
        }),
      setCookies: () => Effect.void,
      agent: () => Effect.succeed(undefined),
    })
}

export type SocketEvent =
  | { readonly _tag: 'Frame'; readonly frame: RtmFrame; readonly receivedAt: number }
  /** `hello` arrived. `fast` when a `reconnect_url` was used. */
  | { readonly _tag: 'Connected'; readonly fast: boolean }
  /** The connection ended; the next attempt starts in `retryInMillis`. */
  | { readonly _tag: 'Disconnected'; readonly reason: string; readonly retryInMillis: number }

export interface SlackSocketShape {
  /** Starts the socket in the scope and returns its events. One connection per call. */
  readonly events: Effect.Effect<Stream.Stream<SocketEvent, SlackAuthRequired>, never, Scope.Scope>
  /** Sends a frame on the open socket with the next id. False when not connected. */
  send(frame: RtmOutgoingFrame): Effect.Effect<boolean>
  /** Sends `tickle` unless one went out within `tickleSpacingMillis`. True when it was sent. */
  tickle(reason: string): Effect.Effect<boolean>
}

type Incoming =
  | { readonly kind: 'upgraded'; readonly status: number }
  | { readonly kind: 'open' }
  | { readonly kind: 'message'; readonly data: string; readonly receivedAt: number }
  | { readonly kind: 'close'; readonly code: number; readonly reason: string }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'rejected'; readonly status: number }
  | { readonly kind: 'cookies'; readonly cookies: ReadonlyArray<string> }
  | { readonly kind: 'pong-timeout' }

/** Why one connection ended and how to come back. */
interface Outcome {
  readonly reason: string
  /** Set by `error.retry_after`; otherwise the backoff schedule decides. */
  readonly delayMillis?: number
  readonly sawHello: boolean
}

interface State {
  reconnect: { url: string; at: number } | undefined
  current: { socket: WebSocket; nextId: () => number } | undefined
}

const FIRST_FRAME_ID = 16385
const CLOSE_NO_PONG = 4998
const CLOSE_NORMAL = 1000

export class SlackSocket extends Context.Service<SlackSocket, SlackSocketShape>()('juno/slack/SlackSocket') {
  static readonly layer: Layer.Layer<SlackSocket, never, SlackApi | SlackSession | SocketHandshake> = Layer.effect(
    SlackSocket,
    Effect.gen(function* () {
      const config = yield* SlackConfig
      const clock = yield* Clock.Clock
      const session = yield* SlackSession
      const api = yield* SlackApi
      const handshake = yield* SocketHandshake
      const state = yield* Ref.make<State>({ reconnect: undefined, current: undefined })
      const diagnostic = (line: string) => config.socket.onDiagnostic?.(line)

      /** The URL for the next connect: a fresh `reconnect_url`, else a new one from the API. */
      const resolveUrl = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const { reconnect } = yield* Ref.get(state)
        yield* Ref.update(state, (s) => ({ ...s, reconnect: undefined }))
        if (reconnect !== undefined && now - reconnect.at < config.socket.reconnectUrlTtlMillis) {
          return { url: reconnect.url, fast: true }
        }
        const answer = yield* api.call('client.getWebSocketURL', {}, { lane: 'interactive', reason: 'socket' })
        const url = new URL(answer.primary_websocket_url)
        url.searchParams.set('token', session.token)
        url.searchParams.set('sync_desync', '1')
        url.searchParams.set('slack_client', 'desktop')
        // No `start_args`. Observed live: any `start_args` value (even `{}`) makes the server accept the
        // upgrade and then send nothing, not even `hello`, for over a minute. Without it `hello` arrives
        // in under a second. Juno loads boot data over HTTP (`client.userBoot`), so it needs no start payload.
        url.searchParams.set('no_query_on_subscribe', '1')
        url.searchParams.set('flannel', '3')
        url.searchParams.set('lazy_channels', '1')
        url.searchParams.set('batch_presence_aware', '1')
        url.searchParams.set('slack_route', slackRoute(session))
        if (answer.routing_context !== undefined) url.searchParams.set('gateway_server', answer.routing_context)
        if (session.enterprise !== undefined) url.searchParams.set('enterprise_id', session.enterprise.id)
        return { url: url.toString(), fast: false }
      })

      /** One connection, from URL to close. Fails only on a fatal auth condition. */
      const connectOnce = (out: Queue.Queue<SocketEvent, SlackAuthRequired | Cause.Done>): Effect.Effect<Outcome, SlackAuthRequired> =>
        Effect.gen(function* () {
          const resolved = yield* Effect.result(resolveUrl)
          if (resolved._tag === 'Failure') {
            const error = resolved.failure
            if (error._tag === 'SlackAuthRequired') return yield* error
            return {
              reason: `url: ${error._tag}`,
              sawHello: false,
              ...(error._tag === 'SlackRateLimited' ? { delayMillis: error.retryAfterMillis } : {}),
            }
          }
          const { url, fast } = resolved.success
          if (!isAllowedHost(url, config)) return { reason: 'socket host not allowed', sawHello: false }

          const incoming = yield* Queue.unbounded<Incoming>()
          const headers = yield* handshake.headers(url)
          const agent = yield* handshake.agent(url)
          const socket = yield* Effect.acquireRelease(
            Effect.sync(() => open(url, headers, agent, config.socket.helloTimeoutMillis, incoming, () => clock.currentTimeMillisUnsafe())),
            (ws) =>
              Effect.gen(function* () {
                yield* Ref.update(state, (s) => (s.current?.socket === ws ? { ...s, current: undefined } : s))
                yield* Effect.sync(() => {
                  ws.removeAllListeners()
                  // Terminating a socket that is still connecting emits `error`; with no listener it is an uncaught exception.
                  ws.on('error', () => {})
                  if (ws.readyState === WebSocket.OPEN) ws.close(CLOSE_NORMAL)
                  else ws.terminate()
                })
              }),
          )
          let id = FIRST_FRAME_ID
          const nextId = () => id++
          let lastPong = yield* Clock.currentTimeMillis

          /** Reads frames until one ends the connection. `untilHello` stops at `hello`. */
          const pump = (untilHello: boolean): Effect.Effect<Outcome | undefined, SlackAuthRequired> =>
            Effect.gen(function* () {
              while (true) {
                const item = yield* Queue.take(incoming)
                switch (item.kind) {
                  case 'upgraded':
                    diagnostic(`upgrade ${item.status}`)
                    break
                  case 'open':
                    diagnostic('open')
                    yield* Ref.update(state, (s) => ({ ...s, current: { socket, nextId } }))
                    break
                  case 'cookies':
                    yield* handshake.setCookies(item.cookies)
                    break
                  case 'close':
                    return { reason: `closed ${item.code}${item.reason === '' ? '' : ` ${item.reason}`}`, sawHello: !untilHello }
                  case 'error':
                    return { reason: `error: ${item.message}`, sawHello: !untilHello }
                  case 'rejected':
                    return { reason: `upgrade rejected ${item.status}`, sawHello: !untilHello }
                  case 'pong-timeout':
                    yield* Effect.sync(() => socket.close(CLOSE_NO_PONG))
                    return { reason: 'no pong', sawHello: true }
                  case 'message': {
                    config.socket.onRawFrame?.(item.data)
                    const frame = decode(item.data)
                    if (frame === undefined) {
                      yield* Effect.logWarning('socket frame skipped', { type: frameType(item.data) })
                      break
                    }
                    if (frame.type === 'pong') lastPong = item.receivedAt
                    yield* Queue.offer(out, { _tag: 'Frame', frame, receivedAt: item.receivedAt })
                    switch (frame.type) {
                      case 'hello':
                        if (untilHello) return undefined
                        break
                      case 'reconnect_url': {
                        const at = yield* Clock.currentTimeMillis
                        yield* Ref.update(state, (s) => ({ ...s, reconnect: { url: frame.url, at } }))
                        break
                      }
                      case 'error':
                        return {
                          reason: `error frame ${frame.error.code}`,
                          sawHello: !untilHello,
                          delayMillis: (frame.error.retry_after ?? 30) * 1000,
                        }
                      case 'goodbye':
                        return { reason: 'goodbye', sawHello: !untilHello }
                      case 'user_session_expiration':
                        return yield* new SlackAuthRequired({ method: 'socket', error: 'user_session_expiration' })
                      default:
                        break
                    }
                    break
                  }
                }
              }
            })

          const beforeHello = yield* pump(true).pipe(
            Effect.timeoutOption(config.socket.helloTimeoutMillis),
            Effect.map((option) => (option._tag === 'None' ? { reason: 'no hello', sawHello: false } : option.value)),
          )
          if (beforeHello !== undefined) return beforeHello
          yield* Queue.offer(out, { _tag: 'Connected', fast })

          const pinger = Effect.gen(function* () {
            while (true) {
              yield* Effect.sleep(config.socket.pingIntervalMillis)
              const now = yield* Clock.currentTimeMillis
              if (now - lastPong > config.socket.pongTimeoutMillis) {
                yield* Queue.offer(incoming, { kind: 'pong-timeout' })
                return
              }
              yield* Effect.sync(() => {
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping', id: nextId() }))
              })
            }
          })
          yield* Effect.forkScoped(pinger)
          return (yield* pump(false)) ?? { reason: 'ended', sawHello: true }
        }).pipe(Effect.scoped)

      /** Connects, waits, reconnects. Ends only when interrupted or on a fatal auth condition. */
      const manage = (out: Queue.Queue<SocketEvent, SlackAuthRequired | Cause.Done>) =>
        Effect.gen(function* () {
          let failures = 0
          while (true) {
            const startedAt = yield* Clock.currentTimeMillis
            const outcome = yield* connectOnce(out)
            const lasted = (yield* Clock.currentTimeMillis) - startedAt
            if (outcome.sawHello && lasted >= config.socket.backoffBaseMillis * 10) failures = 0
            else failures++
            const delay = outcome.delayMillis ?? backoff(config, failures)
            yield* Effect.logDebug('socket disconnected', { reason: outcome.reason, retryInMillis: delay })
            yield* Queue.offer(out, { _tag: 'Disconnected', reason: outcome.reason, retryInMillis: delay })
            yield* Effect.sleep(delay)
          }
        })

      const events = Effect.gen(function* () {
        const out = yield* Queue.unbounded<SocketEvent, SlackAuthRequired | Cause.Done>()
        yield* Effect.forkScoped(
          manage(out).pipe(
            Effect.catchTag('SlackAuthRequired', (error) => Queue.fail(out, error)),
            Effect.ensuring(Queue.end(out)),
          ),
        )
        return Stream.fromQueue(out)
      })

      const send = (frame: RtmOutgoingFrame) =>
        Effect.gen(function* () {
          const { current } = yield* Ref.get(state)
          if (current === undefined || current.socket.readyState !== WebSocket.OPEN) return false
          current.socket.send(JSON.stringify({ ...frame, id: frame.id ?? current.nextId() }))
          return true
        })

      let lastTickle: number | undefined
      const tickle = (reason: string) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          if (lastTickle !== undefined && now - lastTickle < config.socket.tickleSpacingMillis) return false
          const sent = yield* send({ type: 'tickle', reason })
          if (sent) lastTickle = now
          return sent
        })

      return SlackSocket.of({ events, send, tickle })
    }),
  )
}

function open(
  url: string,
  headers: Readonly<Record<string, string>>,
  agent: Agent | undefined,
  handshakeTimeout: number,
  incoming: Queue.Queue<Incoming>,
  currentTimeMillis: () => number,
): WebSocket {
  const socket = new WebSocket(url, { headers, ...(agent === undefined ? {} : { agent }), followRedirects: false, handshakeTimeout })
  const push = (item: Incoming) => {
    Queue.offerUnsafe(incoming, item)
  }
  socket.on('open', () => push({ kind: 'open' }))
  socket.on('message', (data) => push({ kind: 'message', data: String(data), receivedAt: currentTimeMillis() }))
  // The reason is the server's short close text (never a payload); it is kept for the reconnect log.
  socket.on('close', (code, reason) => push({ kind: 'close', code, reason: reason.toString('utf8').slice(0, 120) }))
  socket.on('error', (error) => push({ kind: 'error', message: error.message }))
  socket.on('unexpected-response', (_request, response) => {
    response.resume()
    push({ kind: 'rejected', status: response.statusCode ?? 0 })
  })
  socket.on('upgrade', (response) => {
    push({ kind: 'upgraded', status: response.statusCode ?? 0 })
    const cookies = response.headers['set-cookie']
    if (cookies !== undefined && cookies.length > 0) push({ kind: 'cookies', cookies })
  })
  return socket
}

function decode(data: string): RtmFrame | undefined {
  try {
    return decodeRtmFrame(JSON.parse(data))
  } catch {
    return undefined
  }
}

/** The `type` of a frame that failed to decode, for the log. Never the payload. */
function frameType(data: string): string {
  try {
    const parsed = JSON.parse(data) as { type?: unknown }
    return typeof parsed.type === 'string' ? parsed.type : 'untyped'
  } catch {
    return 'not json'
  }
}

function isAllowedHost(url: string, config: SlackConfigShape): boolean {
  const host = new URL(url).hostname
  return config.socket.allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

/** Exponential with full jitter in [0.5, 1.5) of the step, capped. */
function backoff(config: SlackConfigShape, failures: number): number {
  const step = Math.min(config.socket.backoffCapMillis, config.socket.backoffBaseMillis * 2 ** Math.max(0, failures - 1))
  return Math.round(step * (0.5 + Math.random()))
}
