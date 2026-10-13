/**
 * The task table's row type. A task is plain data: a prompt, a renderer for
 * its input, a tier (which model and how long to wait), and for structured
 * tasks the TypeBox schema of the one tool the model must call.
 */
import { validateToolArguments, type ClassifierAnswer, type ClassifierContext, type Static, type TSchema } from '@earendil-works/pi-ai'
import { createHash } from 'node:crypto'
import type { Tier } from './config'

/**
 * How a decision model (System One classifier) answers the task: `ask` turns
 * the input into a JSON state and typed questions, `read` turns the answers
 * into the task's raw output, which then goes through `validateOutput` like a
 * tool call. A task without a mapping always uses the chat model.
 */
export interface ClassifierMapping<I> {
  readonly ask: (input: I) => ClassifierContext
  readonly read: (answers: Readonly<Record<string, ClassifierAnswer>>, input: I) => unknown
}

interface TaskBase<I> {
  readonly name: string
  /** Bump when the prompt or the output changes meaning, so cached results are not reused. */
  readonly version: number
  readonly tier: Tier
  readonly timeoutMillis: number
  /** The system prompt. */
  readonly prompt: string
  /** The user message: the input as plain text the model reads. */
  readonly render: (input: I) => string
  /** The entity a result belongs to (a topic id, a channel id), for the cache. '' when none. */
  readonly key: (input: I) => string
}

/** A decision: the model answers by calling one tool whose parameters are `output`. */
export interface StructuredTask<I, S extends TSchema = TSchema> extends TaskBase<I> {
  readonly shape: 'structured'
  readonly tool: { readonly name: string; readonly description: string }
  readonly output: S
  /** Checks the schema cannot: ids point into the input, counts hold. False means invalid output. */
  readonly accept?: (output: Static<S>, input: I) => boolean
  /** Present when a decision model can answer the task. Used when the classifier slug is set. */
  readonly classify?: ClassifierMapping<I>
}

/** Text out: a title, a summary, or a recipe in a vocabulary the task checks. */
export interface TextTask<I> extends TaskBase<I> {
  readonly shape: 'text'
  readonly maxChars: number
  /**
   * Checks the trimmed text beyond "not empty", and may rewrite it to a
   * canonical form (topic art stores the recipe it rebuilds, not the reply).
   * A failure is invalid output: the provider retries once.
   */
  readonly check?: (text: string, input: I) => Validation<string>
  /**
   * The message the retry sends after an invalid answer, with the failure's
   * reason, so the model can correct the one thing that was wrong. Without
   * it the retry repeats the original request.
   */
  readonly retry?: (reason: string) => string
}

export type Task<I = unknown> = StructuredTask<I, TSchema> | TextTask<I>

export const DECISION_TIMEOUT_MILLIS = 1500
export const GENERATION_TIMEOUT_MILLIS = 20_000
/** Topic art: the study's p90 was 4.8 s, the live check on 2026-10-14 saw 4.5 to 9.5 s per call; nothing waits on it, so there is room for one retry. */
export const ART_TIMEOUT_MILLIS = 15_000

export function defineStructuredTask<I, S extends TSchema>(
  task: Omit<StructuredTask<I, S>, 'shape' | 'timeoutMillis'> & { readonly timeoutMillis?: number },
): StructuredTask<I, S> {
  return { ...task, shape: 'structured', timeoutMillis: task.timeoutMillis ?? timeoutForTier(task.tier) }
}

export function defineTextTask<I>(task: Omit<TextTask<I>, 'shape' | 'timeoutMillis'> & { readonly timeoutMillis?: number }): TextTask<I> {
  return { ...task, shape: 'text', timeoutMillis: task.timeoutMillis ?? timeoutForTier(task.tier) }
}

function timeoutForTier(tier: Tier): number {
  switch (tier) {
    case 'decision':
      return DECISION_TIMEOUT_MILLIS
    case 'generation':
      return GENERATION_TIMEOUT_MILLIS
    case 'art':
      return ART_TIMEOUT_MILLIS
  }
}

export type Validation<O> = { readonly ok: true; readonly value: O } | { readonly ok: false; readonly message: string }

/** Schema check with pi-ai's validator (coercing where TypeBox allows), then the task's `accept`. */
export function validateOutput<I, S extends TSchema>(task: StructuredTask<I, S>, input: I, args: unknown): Validation<Static<S>> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return { ok: false, message: 'arguments are not an object' }
  let value: Static<S>
  try {
    const tool = { name: task.tool.name, description: task.tool.description, parameters: task.output }
    value = validateToolArguments(tool, { type: 'toolCall', id: 'out', name: task.tool.name, arguments: args as Record<string, never> })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (task.accept && !task.accept(value, input)) return { ok: false, message: 'output does not fit the input' }
  return { ok: true, value }
}

/** Text output trimmed to the task's limit, or undefined when there is nothing usable. */
export function cleanText(task: { readonly maxChars: number }, text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.length <= task.maxChars ? trimmed : trimmed.slice(0, task.maxChars).trimEnd()
}

export interface CacheKey {
  readonly task: string
  readonly key: string
  /** Hash of the task version and the canonical input. Same input, same hash, in any key order. */
  readonly inputHash: string
}

export function cacheKeyOf<I>(task: Task<I>, input: I): CacheKey {
  const hash = createHash('sha256').update(`${task.version}\n${canonicalJson(input)}`).digest('hex').slice(0, 16)
  return { task: task.name, key: task.key(input), inputHash: hash }
}

/** JSON with object keys sorted and undefined values dropped, so equal inputs serialize the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).toSorted()) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) out[key] = sortKeys(item)
    }
    return out
  }
  return value
}
