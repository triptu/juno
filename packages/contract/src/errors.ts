/**
 * Errors that cross the port. Every route error is one of these classes so the
 * renderer can switch on `_tag`. Internal engine errors that never reach the
 * renderer may use `Data.TaggedError` instead.
 */
import { Schema } from 'effect'

export class NotSignedIn extends Schema.TaggedError<NotSignedIn>()('NotSignedIn', {}) {}

export class Offline extends Schema.TaggedError<Offline>()('Offline', {}) {}

export class SlackRejected extends Schema.TaggedError<SlackRejected>()('SlackRejected', {
  /** Slack's `error` string, for example `not_in_channel`. */
  code: Schema.String,
}) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()('RateLimited', {
  /** Seconds until the method may be called again. */
  retryAfter: Schema.Number,
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
  kind: Schema.String,
  id: Schema.String,
}) {}

export class AiUnavailable extends Schema.TaggedError<AiUnavailable>()('AiUnavailable', {
  reason: Schema.Literals(['off', 'budget', 'provider']),
}) {}

export class Invalid extends Schema.TaggedError<Invalid>()('Invalid', {
  issues: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
}) {}

export class ProtocolError extends Schema.TaggedError<ProtocolError>()('ProtocolError', {
  message: Schema.String,
}) {}

/** The union every command may fail with besides its own errors. */
export const CommonError = Schema.Union([NotSignedIn, Offline, SlackRejected, RateLimited, NotFound, Invalid])
export type CommonError = typeof CommonError.Type
