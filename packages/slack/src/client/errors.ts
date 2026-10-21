/**
 * Errors of the Slack client. All are `Schema.TaggedError` so they can cross
 * the engine port as values. `method` is the Web API method, the edge method
 * (`users/info`) or `socket`.
 */
import { Schema as S } from 'effect'
import { FatalAuthErrors, RateLimitErrors } from '@juno/slack-schema'

/**
 * The session is unusable: one of the fatal auth errors came back, or the
 * socket was told the session expired. Nothing is retried; the engine must
 * ask the user to sign in again.
 */
export class SlackAuthRequired extends S.TaggedError<SlackAuthRequired>()('SlackAuthRequired', {
  method: S.String,
  error: S.String,
}) {}

/** HTTP 429 or an `ok:false` rate-limit error. The method is paused until `retryAfterMillis` from now. */
export class SlackRateLimited extends S.TaggedError<SlackRateLimited>()('SlackRateLimited', {
  method: S.String,
  retryAfterMillis: S.Number,
}) {}

/** Slack answered `ok:false` with an error that is neither auth nor rate limit, for example `channel_not_found`. */
export class SlackRejected extends S.TaggedError<SlackRejected>()('SlackRejected', {
  method: S.String,
  error: S.String,
  warning: S.optionalKey(S.String),
  needed: S.optionalKey(S.String),
  provided: S.optionalKey(S.String),
}) {}

/** The request did not produce a usable answer: network failure, timeout, or an HTTP status that is not 200 or 429. */
export class SlackTransportError extends S.TaggedError<SlackTransportError>()('SlackTransportError', {
  method: S.String,
  status: S.optionalKey(S.Number),
  message: S.String,
  /** True for 5xx, timeouts and connection failures; false for other statuses. */
  retryable: S.Boolean,
}) {}

/** The answer was HTTP 200 and JSON but not the shape the schema expects. Never retried. */
export class SlackDecodeError extends S.TaggedError<SlackDecodeError>()('SlackDecodeError', {
  method: S.String,
  message: S.String,
  schemaPath: S.optionalKey(S.String),
  issueKind: S.optionalKey(S.Literals(['missing', 'wrong_type', 'invalid'])),
}) {}

export type SlackApiError = SlackAuthRequired | SlackRateLimited | SlackRejected | SlackTransportError | SlackDecodeError

export const isFatalAuthError = (error: string): boolean => (FatalAuthErrors as ReadonlyArray<string>).includes(error)
export const isRateLimitError = (error: string): boolean => (RateLimitErrors as ReadonlyArray<string>).includes(error)

/** `ok:false` errors that mean "try again", from the official client's retry list (research section 6). */
export const TransientErrors = ['internal_error', 'fatal_error', 'service_unavailable'] as const
export const isTransientError = (error: string): boolean => (TransientErrors as ReadonlyArray<string>).includes(error)

/** HTTP statuses the official client retries. */
export const isRetryableStatus = (status: number): boolean => status === 500 || status === 502 || status === 503 || status === 504
