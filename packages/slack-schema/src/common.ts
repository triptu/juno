/**
 * Shared pieces: the response envelope, the codecs for form fields and the
 * fallback used by every union that must tolerate shapes Slack has not shown
 * us yet.
 *
 * Conventions for every schema in this package:
 * - Decoding never fails on extra keys. `Schema.Struct` strips keys it does not
 *   know; where Juno must keep them (prefs, raw fallbacks) the schema says so.
 * - Only fields that Juno reads are required. Everything else is `optionalKey`.
 * - Field names are Slack's. No renaming on the wire.
 */
import { Schema as S, SchemaGetter } from 'effect'

/** A JSON object whose keys we do not interpret. Keeps every key. */
export const RawObject = S.Record(S.String, S.Unknown)
export type RawObject = typeof RawObject.Type

/** The fallback member of a tolerant union: `{ type: 'unknown', raw }` where `raw` is the object as received. */
export const UnknownVariant = RawObject.pipe(
  S.decodeTo(S.Struct({ type: S.Literal('unknown'), raw: RawObject }), {
    decode: SchemaGetter.transform((raw) => ({ type: 'unknown' as const, raw })),
    encode: SchemaGetter.transform((u) => u.raw),
  }),
)
export type UnknownVariant = typeof UnknownVariant.Type

/** Form fields are strings. These codecs give the typed side numbers, booleans and objects. */
export const FormNumber = S.NumberFromString
export const FormBoolean = S.Literals(['true', 'false', '1', '0']).pipe(
  S.decodeTo(S.Boolean, {
    decode: SchemaGetter.transform((s) => s === 'true' || s === '1'),
    encode: SchemaGetter.transform((b) => (b ? 'true' : 'false')),
  }),
)
/** Like `FormBoolean` but encoded as `1`/`0`, for the few methods whose official caller sends numbers (`read`). */
export const FormBit = S.Literals(['1', '0', 'true', 'false']).pipe(
  S.decodeTo(S.Boolean, {
    decode: SchemaGetter.transform((s) => s === '1' || s === 'true'),
    encode: SchemaGetter.transform((b) => (b ? '1' : '0')),
  }),
)
/**
 * A list of strings in one form field. The official client's form builder
 * (`getFormData`) appends a plain string array as is, so `FormData` sends it
 * comma-joined (`F1,F2`). Decoding also accepts a JSON array.
 */
export const FormList = S.String.pipe(
  S.decodeTo(S.Array(S.String), {
    decode: SchemaGetter.transform((s) => (s.trimStart().startsWith('[') ? (JSON.parse(s) as ReadonlyArray<string>) : s.split(',').filter((id) => id !== ''))),
    encode: SchemaGetter.transform((list) => list.join(',')),
  }),
)
/** A JSON document carried inside one form field (`blocks`, `cached_latest_updates`, `files`). */
export const FormJson = <T extends S.Top>(schema: T) => S.fromJsonString(schema)

/** Fields the transport adds to every Web API call. Methods declare only their own arguments. */
export const CommonArgs = S.Struct({
  token: S.String,
  _x_reason: S.optionalKey(S.String),
  _x_mode: S.optionalKey(S.Literals(['online', 'degraded', 'offline'])),
  _x_app_name: S.optionalKey(S.String),
  _x_sonic: S.optionalKey(FormBoolean),
})
export type CommonArgs = typeof CommonArgs.Type

export const ResponseMetadata = S.Struct({
  next_cursor: S.optionalKey(S.String),
  messages: S.optionalKey(S.Array(S.String)),
  warnings: S.optionalKey(S.Array(S.String)),
})
export type ResponseMetadata = typeof ResponseMetadata.Type

/** `{ ok: false, error }`. Slack sends it with HTTP 200 except for rate limits (429). */
export const ErrorResponse = S.Struct({
  ok: S.Literal(false),
  error: S.String,
  needed: S.optionalKey(S.String),
  provided: S.optionalKey(S.String),
  warning: S.optionalKey(S.String),
  context: S.optionalKey(S.Unknown),
  response_metadata: S.optionalKey(ResponseMetadata),
})
export type ErrorResponse = typeof ErrorResponse.Type

/** `{ ok: true, ...fields }`. */
export const okResponse = <const F extends S.Struct.Fields>(fields: F) => S.Struct({ ok: S.Literal(true), ...fields })

/** Errors the official client never retries. Any of these means the session is unusable. */
export const FatalAuthErrors = [
  'invalid_auth',
  'account_inactive',
  'token_revoked',
  'not_authed',
  'missing_scope',
  'org_login_required',
  'active_migration',
  'accesslimited',
  'access_paused',
  'two_factor_setup_required',
  'user_in_no_workspaces',
  'mobile_login_required',
  'user_needs_to_accept_custom_tos',
  'enterprise_active_migration',
] as const

/** `error` values that mean "slow down". Retry after `Retry-After` seconds, default 60. */
export const RateLimitErrors = [
  'ratelimited',
  'rate_limited',
  'rate_limit_exceeded',
  'rate_limit_reached',
  'ratelimit',
  'rate_limit',
] as const
