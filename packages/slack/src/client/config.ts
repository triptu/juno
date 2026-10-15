/**
 * Tunables of the client. A `Context.Reference` with defaults, so nothing
 * has to provide it; tests and the app override the parts they need with
 * `SlackConfig.layer({ ... })`.
 *
 * The defaults follow docs/architecture.md section 5.1 and 6 and the
 * official client's numbers in docs/research/slack-data-access.md section 6.
 */
import { Context, Layer } from 'effect'

export interface SlackConfigShape {
  /** Replaces `<workspace url>/api`. Tests point it at the fake. */
  readonly apiBaseUrl?: string
  /** Build version of the official client; sent as `_x_version_ts` and the prefix of `_x_id` when known. */
  readonly versionTs?: string
  /** Request timeout. The official client uses 60 s. */
  readonly requestTimeoutMillis: number
  /** Attempts per call, counting the first. */
  readonly maxAttempts: number
  /** Pause after a 429 without `Retry-After`. */
  readonly defaultRetryAfterMillis: number
  /** Longest pause the client honours, whatever `Retry-After` says. */
  readonly maxRetryAfterMillis: number
  /** Base delay for 5xx and network retries; doubles per attempt, jittered. */
  readonly transientBackoffMillis: number
  readonly transientBackoffCapMillis: number
  /** The interactive lane never waits longer than this on a paused method; it fails with `SlackRateLimited` instead. */
  readonly interactiveMaxWaitMillis: number
  readonly lanes: {
    readonly interactiveConcurrency: number
    readonly backgroundConcurrency: number
    /** Override per-method background spacing; zero disables pacing in fake-server tests. */
    readonly backgroundMinIntervalMillis?: number
    readonly sendConcurrency: number
  }
  readonly socket: {
    readonly pingIntervalMillis: number
    /** Close with 4998 and reconnect when no pong arrived for this long. */
    readonly pongTimeoutMillis: number
    /** Give up a connect attempt that has not received `hello` by then. */
    readonly helloTimeoutMillis: number
    readonly backoffBaseMillis: number
    readonly backoffCapMillis: number
    /** A `reconnect_url` is used only within this window (the official client: 285 s). */
    readonly reconnectUrlTtlMillis: number
    /** Hosts a socket URL may point at (exact or any subdomain). The official client only accepts slack.com hosts. */
    readonly allowedHosts: ReadonlyArray<string>
    /** Diagnostics only (the live smoke): sees every frame's text before decoding. Never log it in the app. */
    readonly onRawFrame?: (data: string) => void
    /** Diagnostics only (the live smoke): one line per connection step (upgrade status, open, close code and reason). No secrets. */
    readonly onDiagnostic?: (line: string) => void
  }
}

export const defaultSlackConfig: SlackConfigShape = {
  requestTimeoutMillis: 60_000,
  maxAttempts: 3,
  defaultRetryAfterMillis: 60_000,
  maxRetryAfterMillis: 180_000,
  transientBackoffMillis: 1_000,
  transientBackoffCapMillis: 15_000,
  interactiveMaxWaitMillis: 5_000,
  lanes: {
    interactiveConcurrency: 3,
    backgroundConcurrency: 2,
    sendConcurrency: 1,
  },
  socket: {
    pingIntervalMillis: 10_000,
    pongTimeoutMillis: 30_000,
    helloTimeoutMillis: 15_000,
    backoffBaseMillis: 1_000,
    backoffCapMillis: 60_000,
    reconnectUrlTtlMillis: 285_000,
    allowedHosts: ['slack.com'],
  },
}

export interface SlackConfigOverrides {
  readonly apiBaseUrl?: string
  readonly versionTs?: string
  readonly requestTimeoutMillis?: number
  readonly maxAttempts?: number
  readonly defaultRetryAfterMillis?: number
  readonly maxRetryAfterMillis?: number
  readonly transientBackoffMillis?: number
  readonly transientBackoffCapMillis?: number
  readonly interactiveMaxWaitMillis?: number
  readonly lanes?: Partial<SlackConfigShape['lanes']>
  readonly socket?: Partial<SlackConfigShape['socket']>
}

export const SlackConfig = Context.Reference<SlackConfigShape>('juno/slack/SlackConfig', {
  defaultValue: () => defaultSlackConfig,
})

export function makeSlackConfig(overrides: SlackConfigOverrides = {}): SlackConfigShape {
  const { lanes, socket, ...rest } = overrides
  return {
    ...defaultSlackConfig,
    ...rest,
    lanes: { ...defaultSlackConfig.lanes, ...lanes },
    socket: { ...defaultSlackConfig.socket, ...socket },
  }
}

/** A layer that replaces the defaults for the parts given. */
export const slackConfigLayer = (overrides: SlackConfigOverrides = {}): Layer.Layer<never> =>
  Layer.succeed(SlackConfig, makeSlackConfig(overrides))
