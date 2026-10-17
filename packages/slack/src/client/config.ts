/**
 * Tunables of the client. A `Context.Reference` with defaults, so nothing
 * has to provide it; tests and the app override the parts they need with
 * `SlackConfig.layer({ ... })`.
 *
 * The defaults follow docs/architecture.md section 5.1 and 6 and the
 * official client's numbers in docs/research/slack-data-access.md section 6.
 */
import { Context, Layer } from 'effect'

/**
 * Background lane spacing (research section 6, "Request pacing policy").
 * Each method has its own clock, so independent methods run side by side;
 * `totalMillis` is a ceiling over all of them. A 429 doubles one method's
 * interval from its own base.
 */
interface BackgroundPacing {
  /** Least time between any two background starts: the ceiling over every method. */
  readonly totalMillis: number
  /** Least time between two starts of a method `methods` does not list. */
  readonly methodMillis: number
  /** Per-method spacing, by queue key: the Web API method name, or `edge:<method>`. */
  readonly methods: Readonly<Record<string, number>>
}

/**
 * The defaults. No method starts more often than before per-method pacing
 * (40 a minute each, measured live without a 429), and every rate stays
 * below Slack's published tier for the public method of the same name:
 * - `conversations.history` and `conversations.replies`: 40 a minute
 *   (Tier 3 is 50+). 147 history and 114 replies calls ran live at this rate
 *   with no 429 (research section 10).
 * - `search.modules.messages`: 10 a minute (`search.messages` is Tier 2,
 *   20+). A sweep reads at most three pages.
 * - `edge:users/info`: 20 a minute (edge limits unknown). Each call names up
 *   to 100 people, so a boot makes a handful.
 * - any other method: 20 a minute. These are rare on the background lane
 *   (the follow pass, lookups, emoji, user groups, a reconnect's metadata).
 * - all methods together: 120 a minute.
 */
const defaultBackgroundPacing: BackgroundPacing = {
  totalMillis: 500,
  methodMillis: 3_000,
  methods: {
    'conversations.history': 1_500,
    'conversations.replies': 1_500,
    'search.modules.messages': 6_000,
    'edge:users/info': 3_000,
  },
}

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
    /** Background spacing per method and in total (`defaultBackgroundPacing`). */
    readonly backgroundPacing: BackgroundPacing
    /** Replaces every background spacing, total and per method, with one value; zero disables pacing in fake-server tests. */
    readonly backgroundMinIntervalMillis?: number
    /** Interactive token refill interval (capacity 20); zero disables it in fake-server tests. */
    readonly interactiveRefillIntervalMillis?: number
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
    /** At most one `tickle` per this long, across reconnects (the official client: 19 s). */
    readonly tickleSpacingMillis: number
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
    backgroundPacing: defaultBackgroundPacing,
    sendConcurrency: 1,
  },
  socket: {
    pingIntervalMillis: 10_000,
    pongTimeoutMillis: 30_000,
    helloTimeoutMillis: 15_000,
    backoffBaseMillis: 1_000,
    backoffCapMillis: 60_000,
    reconnectUrlTtlMillis: 285_000,
    tickleSpacingMillis: 19_000,
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

/**
 * Tests only: the default pacing with every spacing divided by `scale`, the
 * total ceiling, each method's and the interactive refill alike, so a paced
 * first sync runs `scale` times faster and its methods keep their real ratios.
 */
export function scaledPacing(scale: number): Partial<SlackConfigShape['lanes']> {
  const pacing = defaultSlackConfig.lanes.backgroundPacing
  return {
    backgroundPacing: {
      totalMillis: pacing.totalMillis / scale,
      methodMillis: pacing.methodMillis / scale,
      methods: Object.fromEntries(Object.entries(pacing.methods).map(([method, millis]) => [method, millis / scale])),
    },
    interactiveRefillIntervalMillis: 500 / scale,
  }
}

/** A layer that replaces the defaults for the parts given. */
export const slackConfigLayer = (overrides: SlackConfigOverrides = {}): Layer.Layer<never> =>
  Layer.succeed(SlackConfig, makeSlackConfig(overrides))
