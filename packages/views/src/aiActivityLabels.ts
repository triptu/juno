/** The words Settings › AI activity uses for a call's feature, outcome and kind (SPEC 13.10, 17). */
import type { AiCallOutcome } from '@juno/contract'

/** What each call was for, in plain words. A feature not listed shows its code. */
const FEATURES: Record<string, string> = {
  titleTopic: 'Title for a thread',
  topicArt: 'Topic art',
  'topicArt.redraw': 'Topic art, redrawn',
  homeTitle: 'Title for Home',
  settledScore: 'Settled check for Home',
  followUps: 'Follow-ups for Home',
  automatedChannel: 'Automated channel check',
  parseCommand: 'Search command',
  routeCheck: 'Wrong-place check',
  notificationReading: 'Notification check',
  instructionRule: 'Instruction check',
  // Calls from before the notification reading, still in the last 500.
  urgencyGate: 'Notification check',
  chat: 'Juno chat turn',
  subagent: 'Juno background job',
  compaction: 'Juno chat compaction',
}

/** The feature of a call, in plain words. */
export const featureLabel = (feature: string): string => FEATURES[feature] ?? feature

export const OUTCOMES: Record<AiCallOutcome, string> = {
  ok: 'OK',
  error: 'Error',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
  timeout: 'Timed out',
}

/** Why a call was not ok, in plain words. A code not listed shows as it is. */
const KINDS: Record<string, string> = {
  'no-key': 'No OpenRouter key',
  cap: 'Daily AI limit reached',
  'no-agent': 'Juno’s agent was not running to check the daily limit',
  'no-answer': 'Juno’s agent did not answer the daily limit check in time',
  'assist-off': 'AI assist is off',
  'too-large': 'The request was too large',
  'key-changed': 'The key changed during the call',
  interrupted: 'Stopped before it finished',
  stopped: 'Stopped before it finished',
  timeout: 'The model took too long',
  'provider-error': 'The model service returned an error',
  'invalid-output': 'The answer could not be used',
  provider: 'The model service returned an error',
  rateLimited: 'Rate limited by the model service',
  keyRejected: 'The key was rejected',
  offline: 'Could not reach the model service',
  // The kinds of a provider error (`@juno/ai` `classifyFailure`).
  policy: 'Refused by the model’s policy',
  'bad-request': 'The model service could not take the request',
  'context-length': 'Too long for the model',
  'model-not-found': 'The model is not available',
  auth: 'The key was rejected',
  credits: 'Out of OpenRouter credits',
  'rate-limited': 'Rate limited by the model service',
  unavailable: 'The model service is down or busy',
  server: 'The model service returned an error',
  network: 'Could not reach the model service',
  unknown: 'The model service returned an error',
  fallback: 'Answered by the fallback model',
}

/** Kinds that trying again cannot change, so Juno does not send the same request again (`isRetryable`). */
const NOT_RETRIED = new Set(['policy', 'bad-request', 'context-length', 'model-not-found', 'auth', 'credits'])
/** A main model's failure that the fallback model was asked about: `policy.fallback`. */
const FALLBACK_SUFFIX = '.fallback'

/** Why a call was not ok, and what Juno did about it: "Refused by the model’s policy. Not retried." */
export function kindLabel(kind: string): string {
  if (kind.endsWith(FALLBACK_SUFFIX)) {
    const base = kind.slice(0, -FALLBACK_SUFFIX.length)
    return `${KINDS[base] ?? base}. Sent to the fallback model.`
  }
  const label = KINDS[kind] ?? kind
  return NOT_RETRIED.has(kind) ? `${label}. Not retried.` : label
}
