/**
 * The edge ("Flannel") API: JSON POST to `<flannel url>/<method>?_x_app_name=client`
 * with the token inside the body (research section 1 and 3). Juno v1 uses it
 * for `users/info` in chunks of 100 (architecture 5.2 step 6). The
 * base URL comes from `api.getFlannelHttpUrl` and is cached for its
 * `ttl_seconds`.
 *
 * Other edge methods (`users/search`, `channels/info`, `emojis/list`, ...)
 * go through `call` with their own schema once Juno needs them; `emojis/list`
 * is the next one (architecture 5.2 step 6).
 */
import { Clock, Context, Effect, Layer, Ref, Schema as S, Semaphore } from 'effect'
import { ErrorResponse } from '@juno/slack-schema'
import { EdgeUsersInfoOk, type EdgeUsersInfoArgs } from '@juno/slack-schema'
import { decodeResponse, SlackApi, withRetries } from './api.ts'
import { SlackConfig } from './config.ts'
import { SlackTransportError, type SlackApiError } from './errors.ts'
import { RequestQueue, type Lane } from './queue.ts'
import { SlackSession } from './session.ts'
import { HttpTransport } from './transport.ts'
import { SlackTrace, traced } from './trace.ts'

export interface EdgeCallOptions {
  /** Default `background`: edge lookups fill caches, they rarely block the user. */
  readonly lane?: Lane
}

export interface SlackEdgeShape {
  /** Users by id, at most 100 per call. `failed_ids` lists the ones Slack did not return. */
  usersInfo(
    ids: ReadonlyArray<string>,
    options?: EdgeCallOptions & { readonly updatedIds?: Readonly<Record<string, number>> },
  ): Effect.Effect<typeof EdgeUsersInfoOk.Type, SlackApiError>
  /** Any edge method. `ok` must be the `ok:true` schema; the token is added to the body here. */
  call<A extends { ok: true }>(
    method: string,
    body: Readonly<Record<string, unknown>>,
    ok: S.Codec<A, unknown>,
    options?: EdgeCallOptions,
  ): Effect.Effect<A, SlackApiError>
}

export class SlackEdge extends Context.Service<SlackEdge, SlackEdgeShape>()('juno/slack/SlackEdge') {
  static readonly layer: Layer.Layer<SlackEdge, never, SlackApi | HttpTransport | SlackSession | RequestQueue> = Layer.effect(
    SlackEdge,
    Effect.gen(function* () {
      const config = yield* SlackConfig
      const session = yield* SlackSession
      const transport = yield* HttpTransport
      const queue = yield* RequestQueue
      const api = yield* SlackApi
      const trace = yield* SlackTrace
      const cached = yield* Ref.make<{ url: string; expiresAt: number } | undefined>(undefined)
      // Calls that start together wait for one fetch instead of each asking Slack.
      const fetching = yield* Semaphore.make(1)

      // On the lane of the call that needs it: an interactive lookup must not wait behind the background backfill.
      const baseUrl = (lane: Lane) => fetching.withPermits(1)(Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const current = yield* Ref.get(cached)
        if (current !== undefined && current.expiresAt > now) return current.url
        const answer = yield* api.call('api.getFlannelHttpUrl', { include_external_workspaces: true }, { lane, reason: 'edge-url' })
        const url = answer.url.replace(/\/+$/, '')
        yield* Ref.set(cached, { url, expiresAt: now + (answer.ttl_seconds ?? 3600) * 1000 })
        return url
      }))

      const call = <A extends { ok: true }>(
        method: string,
        body: Readonly<Record<string, unknown>>,
        ok: S.Codec<A, unknown>,
        options: EdgeCallOptions = {},
      ): Effect.Effect<A, SlackApiError> =>
        Effect.gen(function* () {
          const schema = S.Union([ok, ErrorResponse])
          const key = `edge:${method}`
          const lane = options.lane ?? 'background'
          const payload = JSON.stringify({ token: session.token, ...body })
          const describe = () => ({
            method: key,
            lane,
            reason: undefined,
            params: Object.entries(body).map(([name, value]): readonly [string, string] => [name, typeof value === 'string' ? value : JSON.stringify(value) ?? '']),
            startedAt: Date.now(),
          })
          return yield* traced(trace, describe, (recorder) => withRetries(queue, config, lane, key, () => {
            const exchange = Effect.gen(function* () {
              const base = yield* baseUrl(lane)
              const response = yield* transport
                .request({
                  url: `${base}/${method}?_x_app_name=client`,
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: payload,
                })
                .pipe(
                  Effect.timeout(config.requestTimeoutMillis),
                  Effect.mapError((error) =>
                    error._tag === 'TimeoutError'
                      ? new SlackTransportError({ method: key, message: 'timeout', retryable: true })
                      : new SlackTransportError({ method: key, message: error.message, retryable: true }),
                  ),
                )
              return (yield* decodeResponse(key, response, schema, config, recorder?.seen)) as A
            })
            return recorder === undefined ? exchange : recorder.exchange(exchange)
          }))
        }).pipe(Effect.withSpan('SlackEdge.call', { attributes: { method } }))

      const usersInfo: SlackEdgeShape['usersInfo'] = (ids, options = {}) => {
        const body: Omit<EdgeUsersInfoArgs, 'token'> =
          options.updatedIds === undefined ? { ids: [...ids] } : { updated_ids: options.updatedIds }
        return call('users/info', body, EdgeUsersInfoOk, options)
      }

      return SlackEdge.of({ call, usersInfo })
    }),
  )
}
