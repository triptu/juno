/**
 * What kind of failure a model provider's error is, read from its text: the
 * HTTP status the SDK puts first ("400 {…}", "Provider (503): …"), then the
 * code and words of OpenRouter's or the model's error body. The kind decides
 * whether trying again can help, and whether a model from another provider
 * might answer instead.
 *
 * Plain functions with no imports, in a package of their own, so the
 * engine's provider (`@juno/ai`) and the agent's guard (`@juno/agent`) sort
 * errors the same way.
 */

export type AiFailureKind =
  /** The model or OpenRouter refused the content: a usage policy, moderation, a safety filter. */
  | 'policy'
  /** The request itself is wrong (400, 422): the same request fails again. */
  | 'bad-request'
  /** The input is longer than the model takes. */
  | 'context-length'
  /** The model slug is unknown, or no provider serves it. */
  | 'model-not-found'
  /** The key is missing, invalid or not allowed. */
  | 'auth'
  /** The account is out of credits. */
  | 'credits'
  /** 429: asked to slow down. */
  | 'rate-limited'
  /** The model or its provider is down or overloaded (502, 503, 529). */
  | 'unavailable'
  /** Another 5xx. */
  | 'server'
  | 'timeout'
  | 'network'
  /** Nothing in the text says which. Treated as worth one more try, as before kinds existed. */
  | 'unknown'

const RETRYABLE: ReadonlySet<AiFailureKind> = new Set(['rate-limited', 'unavailable', 'server', 'timeout', 'network', 'unknown'])
/** Another provider's model may answer what this one refused or could not serve. */
const FALLBACK: ReadonlySet<AiFailureKind> = new Set(['policy', 'model-not-found', 'unavailable'])

/** Whether the same request can succeed later. A kind that is not is never sent again for the same input. */
export const isRetryable = (kind: AiFailureKind): boolean => RETRYABLE.has(kind)

/** Whether a fallback model from another provider is worth one call. */
export const fallbackHelps = (kind: AiFailureKind): boolean => FALLBACK.has(kind)

/** The HTTP status at the start of an SDK error ("401 …", "429: {…}") or in pi's prefixed form ("Provider (503): …"). */
export function failureStatus(text: string): number | undefined {
  const found = /^([1-5]\d\d)\b/.exec(text) ?? /^[^\n(]*\(([1-5]\d\d)\):/.exec(text)
  return found ? Number(found[1]) : undefined
}

/** The `code` of an error body sent inside a 200 stream (`{"error":{"code":403,…}}`). */
const bodyCode = (text: string): number | undefined => {
  const found = /"code"\s*:\s*"?([1-5]\d\d)\b/.exec(text)
  return found ? Number(found[1]) : undefined
}

const POLICY = /usage polic|content polic|acceptable use|violat|moderation|flagged|refusal|refused to|safety|content_filter|content filter|sensitive|guardrail|prohibited content/i
const CONTEXT = /context.?length|context window|maximum context|too many tokens|prompt is too long|input is too long|too long for|reduce the length|maximum.*tokens.*exceed/i
const MODEL = /no endpoints found|model.{0,40}(not found|not available|does not exist|unavailable)|not a valid model|invalid model|unknown model|no allowed providers/i
const CREDITS = /insufficient (credits|balance|funds)|out of credits|requires more credits|payment required|credit limit/i
const AUTH = /api key|unauthori[sz]ed|authentication|user not found|no auth credentials|key (is )?(invalid|disabled|revoked)/i
const RATE = /rate.?limit|too many requests/i
const UNAVAILABLE = /overloaded|service unavailable|no available model provider|bad gateway|temporarily unavailable|is down/i
const TIMEOUT = /timed? ?out|timeout|deadline/i
const NETWORK = /fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|EPIPE|socket|terminated|offline/i

/** Sorts a provider's error text into a kind. Order matters: a 403 that names a policy is `policy`, not `auth`. */
export function classifyFailure(text: string): AiFailureKind {
  const status = failureStatus(text) ?? bodyCode(text)
  if (POLICY.test(text)) return 'policy'
  if (status === 402 || CREDITS.test(text)) return 'credits'
  if (status === 413 || CONTEXT.test(text)) return 'context-length'
  if (status === 404 || MODEL.test(text)) return 'model-not-found'
  if (status === 429 || RATE.test(text)) return 'rate-limited'
  if (status === 401 || status === 403 || AUTH.test(text)) return 'auth'
  if (status === 502 || status === 503 || status === 529 || UNAVAILABLE.test(text)) return 'unavailable'
  if (status === 408 || status === 504 || TIMEOUT.test(text)) return 'timeout'
  if (status !== undefined && status >= 500) return 'server'
  if (status === 400 || status === 422) return 'bad-request'
  if (NETWORK.test(text)) return 'network'
  return 'unknown'
}

/**
 * The provider answered with a 4xx status before any output: an SDK error
 * that starts with the status, which comes from the response's headers. Such
 * a request is not billed. An error inside a 200 stream may have been, and
 * is not this.
 */
export function refusedBeforeOutput(text: string | undefined): boolean {
  if (text === undefined) return false
  const status = failureStatus(text)
  return (status !== undefined && status >= 400 && status < 500 && status !== 408) || RATE.test(text)
}

/** "anthropic" for "anthropic/claude-sonnet-5.5": who makes the model, so a fallback can be from someone else. */
export const modelMaker = (slug: string): string => slug.split('/')[0]!.replace(/^~/, '').toLowerCase()
