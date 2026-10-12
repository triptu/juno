/**
 * `SlackApi.call(method, args)`: one typed call driven by the `Methods`
 * table. Encodes the arguments as `multipart/form-data` with `token` first,
 * posts to `<base>/api/<method>`, decodes the answer with the method's
 * response schema and turns `ok:false` into typed errors.
 *
 * Query string (research section 1; section 8 for the minimal set):
 * - `_x_id=<version prefix>-<unix.sss>`: request id, always sent.
 * - `slack_route=<team>` or `<enterprise>:<team>`: always sent.
 * - `_x_app_name=client`: always sent; the gantry client identifies itself so.
 * - `_x_version_ts`: only when the config knows the official build version.
 * - `_x_num_retries=<n>`: on retries only.
 * Not sent: `fp`, `_x_gantry`, `_x_sonic`, `_x_desktop_ia`, `_x_csid`,
 * `_x_frontend_build_type` and the b3 trace ids. They identify the official
 * client's build and session and are not known to be validated; if a live
 * check shows they matter, add them here and nowhere else.
 *
 * Form fields: `token`, then `_x_reason` when the caller gives one, then
 * `_x_mode=online`, then the method's own fields.
 *
 * Retries (architecture 5.1): up to `maxAttempts`. A 429 pauses the method's
 * bucket in `RequestQueue` for `Retry-After` and the next attempt waits on it
 * (the interactive lane fails instead of waiting long). 5xx, timeouts and
 * connection failures back off exponentially with jitter. Fatal auth errors,
 * other `ok:false` errors and decode failures are never retried.
 */
import { Clock, Context, Effect, Layer, Result, Schema as S } from 'effect'
import { Methods, type MethodArgs, type MethodName, type MethodOk } from '@juno/slack-schema'
import { SlackConfig, type SlackConfigShape } from './config.ts'
import {
  isFatalAuthError,
  isRateLimitError,
  isRetryableStatus,
  isTransientError,
  SlackAuthRequired,
  SlackDecodeError,
  SlackRateLimited,
  SlackRejected,
  SlackTransportError,
  type SlackApiError,
} from './errors.ts'
import { RequestQueue, type Lane } from './queue.ts'
import { apiBaseFromWorkspace, SlackSession, slackRoute } from './session.ts'
import { HttpTransport, type HttpResponse } from './transport.ts'

export interface CallOptions {
  /** Default `interactive`. */
  readonly lane?: Lane
  /** Sent as `_x_reason`, like the official client's `fetch-client-data`. Short, no user data. */
  readonly reason?: string
}

export interface SlackApiShape {
  call<M extends MethodName>(method: M, args: MethodArgs<M>, options?: CallOptions): Effect.Effect<MethodOk<M>, SlackApiError>
}

export class SlackApi extends Context.Service<SlackApi, SlackApiShape>()('juno/slack/SlackApi') {
  static readonly layer: Layer.Layer<SlackApi, never, HttpTransport | SlackSession | RequestQueue> = Layer.effect(
    SlackApi,
    Effect.gen(function* () {
      const config = yield* SlackConfig
      const session = yield* SlackSession
      const transport = yield* HttpTransport
      const queue = yield* RequestQueue
      const base = config.apiBaseUrl ?? apiBaseFromWorkspace(session.workspaceUrl)
      const route = slackRoute(session)

      const once = <M extends MethodName>(method: M, fields: ReadonlyArray<readonly [string, string]>, attempt: number) =>
        Effect.gen(function* () {
          const url = new URL(`${base}/${method}`)
          url.searchParams.set('_x_id', yield* requestId(config.versionTs))
          url.searchParams.set('slack_route', route)
          url.searchParams.set('_x_app_name', 'client')
          if (config.versionTs !== undefined) url.searchParams.set('_x_version_ts', config.versionTs)
          if (attempt > 0) url.searchParams.set('_x_num_retries', String(attempt))
          const body = new FormData()
          for (const [name, value] of fields) body.append(name, value)
          const response = yield* transport
            .request({ url: url.toString(), method: 'POST', headers: {}, body })
            .pipe(
              Effect.timeout(config.requestTimeoutMillis),
              Effect.mapError((error) =>
                error._tag === 'TimeoutError'
                  ? new SlackTransportError({ method, message: 'timeout', retryable: true })
                  : new SlackTransportError({ method, message: error.message, retryable: true }),
              ),
            )
          return yield* decodeResponse(method, response, Methods[method].response, config)
        })

      const call = <M extends MethodName>(method: M, args: MethodArgs<M>, options: CallOptions = {}) =>
        Effect.gen(function* () {
          const lane = options.lane ?? 'interactive'
          const fields = encodeFields(method, args, session.token, options.reason)
          return yield* withRetries(queue, config, lane, method, (attempt) => once(method, fields, attempt))
        }).pipe(Effect.withSpan('SlackApi.call', { attributes: { method, lane: options.lane ?? 'interactive' } }))

      return SlackApi.of({ call })
    }),
  )
}

// Shared with SlackEdge.

/** `_x_id`: the official client's `<8 chars of version>-<seconds.millis>`. */
export const requestId = (versionTs: string | undefined) =>
  Effect.map(Clock.currentTimeMillis, (now) => `${versionTs?.slice(0, 8) ?? 'noversion'}-${(now / 1000).toFixed(3)}`)

/** Form fields in wire order: `token` first, then the transport's own fields, then the method's. */
export function encodeFields<M extends MethodName>(
  method: M,
  args: MethodArgs<M>,
  token: string,
  reason: string | undefined,
): ReadonlyArray<readonly [string, string]> {
  const encoded = S.encodeSync(Methods[method].args)(args as never) as Record<string, unknown>
  const fields: Array<readonly [string, string]> = [['token', token]]
  if (reason !== undefined) fields.push(['_x_reason', reason])
  fields.push(['_x_mode', 'online'])
  for (const [name, value] of Object.entries(encoded)) {
    if (name === 'token' || value === undefined) continue
    fields.push([name, typeof value === 'string' ? value : JSON.stringify(value)])
  }
  return fields
}

/**
 * Maps an HTTP answer to the decoded `ok:true` payload or a typed error.
 * `schema` must accept both the ok and the `{ ok:false, error }` shapes.
 */
export const decodeResponse = <A extends { ok: boolean }>(
  method: string,
  response: HttpResponse,
  schema: S.Codec<A, unknown>,
  config: SlackConfigShape,
) =>
  Effect.gen(function* () {
    const retryAfter = retryAfterMillis(response.header('retry-after'), config.defaultRetryAfterMillis)
    if (response.status === 429) return yield* new SlackRateLimited({ method, retryAfterMillis: retryAfter })
    if (response.status !== 200) {
      return yield* new SlackTransportError({
        method,
        status: response.status,
        message: `HTTP ${response.status}`,
        retryable: isRetryableStatus(response.status),
      })
    }
    const json = yield* Effect.try({
      try: () => JSON.parse(response.text) as unknown,
      catch: () => new SlackTransportError({ method, status: 200, message: 'response is not JSON', retryable: true }),
    })
    const decoded = yield* S.decodeUnknownEffect(schema)(json).pipe(
      Effect.mapError((error) => new SlackDecodeError({ method, message: error.message.slice(0, 300) })),
    )
    if (decoded.ok) return decoded as Extract<A, { ok: true }>
    const error = (decoded as unknown as { error: string; warning?: string; needed?: string; provided?: string }).error
    if (isFatalAuthError(error)) return yield* new SlackAuthRequired({ method, error })
    if (isRateLimitError(error)) return yield* new SlackRateLimited({ method, retryAfterMillis: retryAfter })
    if (isTransientError(error)) return yield* new SlackTransportError({ method, status: 200, message: error, retryable: true })
    const rest = decoded as unknown as { warning?: string; needed?: string; provided?: string }
    return yield* new SlackRejected({
      method,
      error,
      ...(rest.warning === undefined ? {} : { warning: rest.warning }),
      ...(rest.needed === undefined ? {} : { needed: rest.needed }),
      ...(rest.provided === undefined ? {} : { provided: rest.provided }),
    })
  })

/** The retry loop of the module comment. `once(attempt)` is one HTTP exchange. */
export const withRetries = <A>(
  queue: RequestQueue['Service'],
  config: SlackConfigShape,
  lane: Lane,
  method: string,
  once: (attempt: number) => Effect.Effect<A, SlackApiError>,
): Effect.Effect<A, SlackApiError> =>
  Effect.gen(function* () {
    for (let attempt = 0; ; attempt++) {
      const result = yield* Effect.result(queue.run(lane, method, once(attempt)))
      if (Result.isSuccess(result)) return result.success
      const error = result.failure
      const last = attempt + 1 >= config.maxAttempts
      if (error._tag === 'SlackRateLimited') {
        yield* queue.pause(method, error.retryAfterMillis)
        if (last) return yield* error
        // The next attempt waits on the bucket; the interactive lane fails there if the wait is long.
      } else if (error._tag === 'SlackTransportError' && error.retryable && !last) {
        yield* Effect.sleep(transientBackoff(config, attempt))
      } else {
        return yield* error
      }
    }
  })

function transientBackoff(config: SlackConfigShape, attempt: number): number {
  const base = Math.min(config.transientBackoffCapMillis, config.transientBackoffMillis * 2 ** attempt)
  return Math.round(base * (0.5 + Math.random()))
}

function retryAfterMillis(header: string | undefined, fallback: number): number {
  const seconds = header === undefined ? Number.NaN : Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : fallback
}
