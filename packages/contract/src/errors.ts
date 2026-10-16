/**
 * Errors that cross the port. Every route error is one of these classes so the
 * renderer can switch on `_tag`. Engine handlers map `@juno/slack` errors to
 * these before they reach a route; a store failure is a bug and becomes a
 * defect (`Effect.orDie`), not one of these.
 */
import { Schema } from 'effect'

export class NotSignedIn extends Schema.TaggedError<NotSignedIn>()('NotSignedIn', {}) {}

export class Offline extends Schema.TaggedError<Offline>()('Offline', {}) {}

/** Slack answered `ok: false`. */
export class Rejected extends Schema.TaggedError<Rejected>()('Rejected', {
  /** Slack's `error` string, for example `not_in_channel`. */
  code: Schema.String,
}) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()('RateLimited', {
  /** Milliseconds until the method may be called again. */
  retryAfterMillis: Schema.Number,
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
  kind: Schema.String,
  id: Schema.String,
}) {}

/**
 * Why an AI command made nothing: AI assist off, the daily cap reached, no
 * OpenRouter key, the agent's spend ledger not answering, the model too slow,
 * an error from the provider, or an answer that was not usable.
 */
export class AiUnavailable extends Schema.TaggedError<AiUnavailable>()('AiUnavailable', {
  reason: Schema.Literals(['off', 'budget', 'no-key', 'no-agent', 'timeout', 'provider', 'invalid']),
}) {}

export class Invalid extends Schema.TaggedError<Invalid>()('Invalid', {
  issues: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
}) {}

export class ProtocolError extends Schema.TaggedError<ProtocolError>()('ProtocolError', {
  message: Schema.String,
}) {}
