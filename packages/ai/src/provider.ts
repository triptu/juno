/**
 * The one interface the rest of Juno talks to. Nothing here throws or fails:
 * a decision that cannot be made is a value, so the UI stays quiet.
 */
import type { Static, TSchema } from '@earendil-works/pi-ai'
import type { TopicId } from '@juno/domain'
import { Context, type Effect, type Stream } from 'effect'
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

export interface ChatToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: Record<string, unknown>
}

export type ChatMessage =
  | { readonly role: 'user'; readonly text: string }
  | { readonly role: 'assistant'; readonly text: string; readonly toolCalls: ReadonlyArray<ChatToolCall> }
  | { readonly role: 'tool'; readonly callId: string; readonly name: string; readonly result: string; readonly isError?: boolean }

export interface ChatContext {
  /** ISO time, so "today" and "this morning" mean something. */
  readonly now: string
  /** The topic the user was last viewing: what "this" means. */
  readonly viewing?: { readonly id: TopicId; readonly title: string; readonly channel: string }
  readonly messages: ReadonlyArray<ChatMessage>
}

export interface ChatTool {
  readonly name: string
  readonly description: string
  readonly parameters: TSchema
}

/** One assistant turn, streamed. Tool calls are validated against `tools` before they are emitted. */
export type ChatEvent =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'toolCall'; readonly call: ChatToolCall }
  | { readonly type: 'done'; readonly text: string; readonly toolCalls: ReadonlyArray<ChatToolCall>; readonly meta: AiCallMeta }
  | { readonly type: 'failed'; readonly reason: NoDecisionReason; readonly detail?: string; readonly meta: AiCallMeta }

export interface AiProviderShape {
  /** Runs a structured task. The model picked by the task's tier must call the task's tool. */
  decide<I, S extends TSchema>(task: StructuredTask<I, S>, input: I): Effect.Effect<Decision<Static<S>>>
  /** Runs a text task. Plain text, trimmed to the task's limit. */
  generate<I>(task: TextTask<I>, input: I): Effect.Effect<Decision<string>>
  /** One Juno chat turn. Ends with `done` or `failed`; the caller runs tools and calls again. */
  chat(context: ChatContext, tools: ReadonlyArray<ChatTool>): Stream.Stream<ChatEvent>
}

export class AiProvider extends Context.Service<AiProvider, AiProviderShape>()('juno/ai/AiProvider') {}
