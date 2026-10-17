/**
 * The one interface the rest of Juno talks to. Nothing here throws or fails:
 * a decision that cannot be made is a value, so the UI stays quiet.
 */
import type { Static, TSchema } from '@earendil-works/pi-ai'
import { Context, type Effect } from 'effect'
import { isRetryable, type AiFailureKind } from '@juno/ai-failure'
import type { StructuredTask, TextTask } from './task'

export type NoDecisionReason =
  /** No OpenRouter key in the config. */
  | 'missing-key'
  /** The task's timeout passed. */
  | 'timeout'
  /** The model did not call the tool, or its arguments failed the schema, twice. */
  | 'invalid-output'
  /** The provider returned an error. `kind` says which; only a retryable kind is tried a second time. */
  | 'provider-error'
  /** The daily spend cap refused the call; nothing was sent. */
  | 'budget'

export interface AiCallMeta {
  readonly model: string
  readonly latencyMillis: number
  /** USD from the provider's price table. Absent when the model is not in it. */
  readonly costUsd?: number
  readonly attempts: number
  /** Tokens across the attempts, as the provider reported them. Absent when it reported none. */
  readonly inputTokens?: number
  readonly outputTokens?: number
  /**
   * Set when this answer came from the fallback model: the main model's call,
   * which failed with `kind` (a policy refusal, or the model unavailable).
   */
  readonly fallbackFor?: FailedCall
}

/** A call that ended in a provider error, as the fallback's answer remembers it. */
export interface FailedCall {
  readonly meta: AiCallMeta
  readonly kind: AiFailureKind
  readonly detail?: string
}

export type Decision<A> =
  | { readonly _tag: 'Decided'; readonly value: A; readonly meta: AiCallMeta }
  | { readonly _tag: 'NoDecision'; readonly reason: NoDecisionReason; readonly detail?: string; readonly kind?: AiFailureKind; readonly meta: AiCallMeta }

/**
 * The same input will fail the same way: the provider refused it for a
 * reason trying again cannot change (a policy, a bad request, too long), and
 * so did the fallback, if one was asked. A job keeps this per input and does
 * not send that input again until it changes.
 */
export function isFinal(decision: Decision<unknown>): boolean {
  if (decision._tag === 'Decided' || decision.reason !== 'provider-error' || decision.kind === undefined || isRetryable(decision.kind)) return false
  const first = decision.meta.fallbackFor
  return first === undefined || !isRetryable(first.kind)
}

export interface AiProviderShape {
  /** Runs a structured task. The model picked by the task's tier must call the task's tool. */
  decide<I, S extends TSchema>(task: StructuredTask<I, S>, input: I): Effect.Effect<Decision<Static<S>>>
  /** Runs a text task. Plain text, trimmed to the task's limit. */
  generate<I>(task: TextTask<I>, input: I): Effect.Effect<Decision<string>>
}

export class AiProvider extends Context.Service<AiProvider, AiProviderShape>()('juno/ai/AiProvider') {}
