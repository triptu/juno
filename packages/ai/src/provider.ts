/**
 * The one interface the rest of Juno talks to. Nothing here throws or fails:
 * a decision that cannot be made is a value, so the UI stays quiet.
 */
import type { Static, TSchema } from '@earendil-works/pi-ai'
import { Context, type Effect } from 'effect'
import type { StructuredTask, TextTask } from './task'

export type NoDecisionReason =
  /** No OpenRouter key in the config. */
  | 'missing-key'
  /** The task's timeout passed. */
  | 'timeout'
  /** The model did not call the tool, or its arguments failed the schema, twice. */
  | 'invalid-output'
  /** Network, auth or provider error, after one retry. */
  | 'provider-error'
  /** The daily spend cap refused the call; nothing was sent. */
  | 'budget'

export interface AiCallMeta {
  readonly model: string
  readonly latencyMillis: number
  /** USD from the provider's price table. Absent when the model is not in it. */
  readonly costUsd?: number
  readonly attempts: number
}

export type Decision<A> =
  | { readonly _tag: 'Decided'; readonly value: A; readonly meta: AiCallMeta }
  | { readonly _tag: 'NoDecision'; readonly reason: NoDecisionReason; readonly detail?: string; readonly meta: AiCallMeta }

export interface AiProviderShape {
  /** Runs a structured task. The model picked by the task's tier must call the task's tool. */
  decide<I, S extends TSchema>(task: StructuredTask<I, S>, input: I): Effect.Effect<Decision<Static<S>>>
  /** Runs a text task. Plain text, trimmed to the task's limit. */
  generate<I>(task: TextTask<I>, input: I): Effect.Effect<Decision<string>>
}

export class AiProvider extends Context.Service<AiProvider, AiProviderShape>()('juno/ai/AiProvider') {}
