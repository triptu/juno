/**
 * `SlackTrace`: what the host hears about each Web API and edge call, for
 * the engine's developer log (`docs/architecture.md`, "Developer log").
 *
 * A `Context.Reference` whose default is off, so nothing has to provide it
 * and a client built without it (tests, the live scripts) does no extra
 * work. When on, `SlackApi` and `SlackEdge` call `started` once per call,
 * before it waits for its lane, and the function it returns once the call
 * ends, whatever the outcome. Both run synchronously and must be cheap.
 *
 * The token is never among `params`; the host strips anything else that
 * looks like a secret before it keeps an entry.
 */
import { Cause, Context, Effect, Exit } from 'effect'
import type { Lane } from './queue.ts'
import type { SlackApiError } from './errors.ts'

export interface SlackCallStart {
  /** The Web API method, or `edge:<method>`. */
  readonly method: string
  readonly lane: Lane
  readonly reason: string | undefined
  /** The method's own fields as sent, without the token. */
  readonly params: ReadonlyArray<readonly [string, string]>
  /** Epoch milliseconds. */
  readonly startedAt: number
}

export type SlackCallOutcome =
  | { readonly _tag: 'ok' }
  /** `ok:false` with a code that is neither auth nor rate limit. */
  | { readonly _tag: 'rejected'; readonly error: string }
  | { readonly _tag: 'auth'; readonly error: string }
  | { readonly _tag: 'rate-limited'; readonly retryAfterMillis: number }
  | { readonly _tag: 'decode'; readonly path: string | undefined; readonly issue: string | undefined }
  | { readonly _tag: 'transport'; readonly message: string; readonly status: number | undefined }
  /** The caller's `beforeSend` stopped it. */
  | { readonly _tag: 'stopped' }
  | { readonly _tag: 'interrupted' }

export interface SlackCallEnd {
  readonly outcome: SlackCallOutcome
  readonly durationMs: number
  /** Time spent outside HTTP exchanges: waiting for the lane, a 429's pause, retry backoff. */
  readonly waitMs: number
  readonly attempts: number
  /** The longest `Retry-After` a 429 asked for during the call; 0 when none. */
  readonly retryAfterMillis: number
  /** Characters of the last response body. */
  readonly size: number
  /** The last parsed response body, to summarise and drop. Undefined when none was JSON. */
  readonly response: unknown
}

export interface SlackTraceShape {
  readonly enabled: boolean
  readonly started: (call: SlackCallStart) => (end: SlackCallEnd) => void
}

const off: SlackTraceShape = { enabled: false, started: () => () => {} }

export const SlackTrace = Context.Reference<SlackTraceShape>('juno/slack/SlackTrace', { defaultValue: () => off })

/** Counts one call's exchanges and keeps its last response. */
export class CallRecorder {
  attempts = 0
  exchangeMs = 0
  retryAfterMillis = 0
  size = 0
  response: unknown = undefined

  /** Wraps one HTTP exchange. */
  exchange<A, R>(effect: Effect.Effect<A, SlackApiError, R>): Effect.Effect<A, SlackApiError, R> {
    return Effect.suspend(() => {
      const start = performance.now()
      this.attempts += 1
      return effect.pipe(
        Effect.tapError((error) => Effect.sync(() => {
          if (error._tag === 'SlackRateLimited') this.retryAfterMillis = Math.max(this.retryAfterMillis, error.retryAfterMillis)
        })),
        Effect.ensuring(Effect.sync(() => { this.exchangeMs += performance.now() - start })),
      )
    })
  }

  /** Called with each response body that parsed as JSON. */
  readonly seen = (json: unknown, size: number): void => {
    this.response = json
    this.size = size
  }
}

const outcomeOf = <A>(exit: Exit.Exit<A, unknown>): SlackCallOutcome => {
  if (Exit.isSuccess(exit)) return { _tag: 'ok' }
  const found = Cause.findErrorOption(exit.cause)
  if (found._tag === 'None') return Cause.hasInterruptsOnly(exit.cause) ? { _tag: 'interrupted' } : { _tag: 'transport', message: 'defect', status: undefined }
  // Or the caller's own error from `beforeSend`, which the default branch takes.
  const error = found.value as SlackApiError
  switch (error._tag) {
    case 'SlackRejected':
      return error.error === 'not_sent' ? { _tag: 'stopped' } : { _tag: 'rejected', error: error.error }
    case 'SlackAuthRequired':
      return { _tag: 'auth', error: error.error }
    case 'SlackRateLimited':
      return { _tag: 'rate-limited', retryAfterMillis: error.retryAfterMillis }
    case 'SlackDecodeError':
      return { _tag: 'decode', path: error.schemaPath, issue: error.issueKind }
    case 'SlackTransportError':
      return { _tag: 'transport', message: error.message, status: error.status }
    default:
      return { _tag: 'stopped' }
  }
}

/**
 * Runs `body` and tells `trace` about it. With the trace off, `body` runs
 * with no recorder and nothing else happens.
 */
export const traced = <A, E, R>(
  trace: SlackTraceShape,
  describe: () => SlackCallStart,
  body: (recorder: CallRecorder | undefined) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  if (!trace.enabled) return body(undefined)
  return Effect.suspend(() => {
    const recorder = new CallRecorder()
    const start = performance.now()
    const end = trace.started(describe())
    return body(recorder).pipe(
      Effect.onExit((exit) => Effect.sync(() => {
        const durationMs = performance.now() - start
        end({
          outcome: outcomeOf(exit),
          durationMs,
          waitMs: Math.max(0, durationMs - recorder.exchangeMs),
          attempts: recorder.attempts,
          retryAfterMillis: recorder.retryAfterMillis,
          size: recorder.size,
          response: recorder.response,
        })
      })),
    )
  })
}
