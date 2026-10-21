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
 * other `ok:false` errors and decode failures are never retried. A call with
 * `singleAttempt` is never retried at all.
 *
 * `beforeSend` runs holding the lane's permit before each exchange, so a
 * check against local state and the request it allows are adjacent on the
 * lane. Its failure ends the call with its own error.
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
import { decodeIssueDetails } from './decodeIssue.ts'
import { SlackTrace, traced, type CallRecorder } from './trace.ts'

export interface CallOptions<E = never> {
  /** Default `interactive`. */
  readonly lane?: Lane
  /** Sent as `_x_reason`, like the official client's `fetch-client-data`. Short, no user data. */
  readonly reason?: string
  /**
   * One HTTP exchange and no retry, whatever the error. For writes whose
   * caller must never submit twice (the agent's sends, plan v3 §6.3): a
   * timeout or 5xx then fails at once and the caller treats it as unknown.
   */
  readonly singleAttempt?: boolean
  /**
   * Runs holding the lane's permit, just before each exchange, so no other
   * call on the lane comes between it and the request. A failure sends
   * nothing and ends the call with that error. For a write that must be
   * checked against the store right before it leaves (a copy's delete,
   * ADR 0014).
   */
  readonly beforeSend?: Effect.Effect<void, E>
}

/** A file's bytes as `upload` sends them. */
export interface UploadBody {
  readonly name: string
  readonly mimetype: string
  readonly bytes: Uint8Array
}

export interface SlackApiShape {
  call<M extends MethodName, E = never>(method: M, args: MethodArgs<M>, options?: CallOptions<E>): Effect.Effect<MethodOk<M>, SlackApiError | E>
  /**
   * Posts a file's bytes to the `upload_url` that `files.getUploadURL`
   * gave, as the official client does: `multipart/form-data` with one
   * field, `file`, and no token (the url carries its own grant). One
   * attempt; any answer but HTTP 200 is a `SlackTransportError`.
   */
  upload(url: string, file: UploadBody): Effect.Effect<void, SlackTransportError>
}

export class SlackApi extends Context.Service<SlackApi, SlackApiShape>()('juno/slack/SlackApi') {
  static readonly layer: Layer.Layer<SlackApi, never, HttpTransport | SlackSession | RequestQueue> = Layer.effect(
    SlackApi,
    Effect.gen(function* () {
      const config = yield* SlackConfig
      const session = yield* SlackSession
      const transport = yield* HttpTransport
      const queue = yield* RequestQueue
      const trace = yield* SlackTrace
      const base = config.apiBaseUrl ?? apiBaseFromWorkspace(session.workspaceUrl)
      const route = slackRoute(session)

      const once = <M extends MethodName>(method: M, fields: ReadonlyArray<readonly [string, string]>, attempt: number, recorder: CallRecorder | undefined) =>
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
          return yield* decodeResponse(method, response, Methods[method].response, config, recorder?.seen)
        }).pipe((exchange) => (recorder === undefined ? exchange : recorder.exchange(exchange)))

      const call = <M extends MethodName, E = never>(method: M, args: MethodArgs<M>, options: CallOptions<E> = {}) => {
        const lane = options.lane ?? 'interactive'
        const fields = encodeFields(method, args, session.token, options.reason)
        // The method's own fields: not the token, nor `_x_reason` and `_x_mode`, which the trace has as `reason` or does not need.
        const describe = () => ({ method, lane, reason: options.reason, params: fields.filter(([name]) => name !== 'token' && !name.startsWith('_x_')), startedAt: Date.now() })
        return traced(trace, describe, (recorder) => Effect.gen(function* () {
          const attempts = options.singleAttempt === true ? { ...config, maxAttempts: 1 } : config
          const before = options.beforeSend
          if (before === undefined) return yield* withRetries(queue, attempts, lane, method, (attempt) => once(method, fields, attempt, recorder))
          // A failed check ends the retries as a refusal would, and the caller gets the check's own error.
          let stopped: { readonly error: E } | undefined
          const checked = (attempt: number) =>
            Effect.flatMap(Effect.result(before), (result) => {
              if (Result.isSuccess(result)) return once(method, fields, attempt, recorder)
              stopped = { error: result.failure }
              return Effect.fail(new SlackRejected({ method, error: 'not_sent' }))
            })
          return yield* withRetries(queue, attempts, lane, method, checked).pipe(
            Effect.catch((error): Effect.Effect<never, SlackApiError | E> => Effect.fail(stopped === undefined ? error : stopped.error)),
          )
        })).pipe(Effect.withSpan('SlackApi.call', { attributes: { method, lane } }))
      }

      const upload = (url: string, file: UploadBody) =>
        Effect.gen(function* () {
          const method = 'upload'
          const body = new FormData()
          body.append('file', new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.mimetype }), file.name)
          const response = yield* transport.request({ url, method: 'POST', headers: {}, body }).pipe(
            // A large file takes longer than a call: the timeout grows by a second per 50 KB.
            Effect.timeout(config.requestTimeoutMillis + Math.ceil(file.bytes.byteLength / 50)),
            Effect.mapError((error) => new SlackTransportError({ method, message: error._tag === 'TimeoutError' ? 'timeout' : error.message, retryable: true })),
          )
          if (response.status !== 200) {
            return yield* new SlackTransportError({ method, status: response.status, message: `HTTP ${response.status}`, retryable: isRetryableStatus(response.status) })
          }
        }).pipe(Effect.withSpan('SlackApi.upload', { attributes: { size: file.bytes.byteLength } }))

      return SlackApi.of({ call, upload })
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
  /** Hears the parsed body and its length before it is decoded (`SlackTrace`). */
  seen?: (json: unknown, size: number) => void,
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
    seen?.(json, response.text.length)
    const decoded = yield* S.decodeUnknownEffect(schema)(json).pipe(
      Effect.mapError((error) => new SlackDecodeError({ method, message: 'response does not match schema', ...decodeIssueDetails(error.issue) })),
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
