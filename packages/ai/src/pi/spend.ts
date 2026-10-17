/**
 * What a call may cost and what it settles in the daily cap: the upper
 * bound reserved before it starts, and the amount settled however it ends.
 */
import type { ModelCost } from '@earendil-works/pi-ai'
import { Effect } from 'effect'
import type { AiConfig } from '../config'
import { refusedBeforeOutput } from '../failure'
import type { Decision } from '../provider'

/** A slug outside pi-ai's price table reserves this much per call and settles as unknown, so it still counts against the cap. */
const UNPRICED_RESERVATION_USD = 0.05
/** Tokens of framing per message, as in the agent's bound (`@juno/agent-memory` `upper`). */
const FRAMING_TOKENS = 64
/** Room for a retry's message with the checker's reason. */
const RETRY_MESSAGE_BYTES = 2048

/** How far a call got: the attempts started so far. */
export interface Progress {
  attempts: number
}

/**
 * The most a call's two attempts can cost: every input byte as a token at the
 * dearest input rate, the retry's copy of the first answer and its message,
 * and both outputs at the cap. Rounded up by the ledger.
 */
export function upperUsd(cost: ModelCost, priced: boolean, input: string, maxTokens: number): number {
  return attemptBounds(cost, priced, input, maxTokens).total
}

/** The most each attempt of a call can cost, and both together (`upperUsd`). */
export interface AttemptBounds {
  readonly first: number
  readonly total: number
}

export function attemptBounds(cost: ModelCost, priced: boolean, input: string, maxTokens: number): AttemptBounds {
  if (!priced) return { first: UNPRICED_RESERVATION_USD, total: UNPRICED_RESERVATION_USD }
  const rates = [cost, ...(cost.tiers ?? [])]
  const inputRate = Math.max(...rates.flatMap((rate) => [rate.input, rate.cacheRead, rate.cacheWrite]))
  const outputRate = Math.max(...rates.map((rate) => rate.output))
  const first = new TextEncoder().encode(input).length + 2 * FRAMING_TOKENS
  const retry = first + 4 * maxTokens + RETRY_MESSAGE_BYTES + 2 * FRAMING_TOKENS
  return {
    first: (first * inputRate + maxTokens * outputRate) / 1_000_000,
    total: ((first + retry) * inputRate + 2 * maxTokens * outputRate) / 1_000_000,
  }
}

/**
 * What to settle: the reported cost when it is known. A call that ended in
 * its first attempt without a report (a timeout, a lost request) never sent
 * the retry, so it settles at the first attempt's bound, which is at least
 * what it can have been billed. Otherwise `undefined`, which keeps the
 * whole reservation.
 */
export function settledUsd<A>(decision: Decision<A>, priced: boolean, bounds: AttemptBounds): number | undefined {
  if (!priced) return undefined
  if (decision._tag === 'Decided' || decision.reason === 'invalid-output') return decision.meta.costUsd
  if (decision.reason === 'provider-error' && refusedBeforeOutput(decision.detail)) return decision.meta.costUsd ?? 0
  if ((decision.reason === 'timeout' || decision.reason === 'provider-error') && decision.meta.attempts === 1) return bounds.first
  return undefined
}

/**
 * What to settle for a call stopped before it ended (its job restarted, the
 * key changed, the app quit). Before any attempt nothing was sent. In the
 * first attempt the retry was never sent, so the first attempt's bound is at
 * least what it can have been billed, as for a timeout. Later, `undefined`
 * keeps the whole reservation.
 */
export function stoppedUsd(priced: boolean, bounds: AttemptBounds, attempts: number): number | undefined {
  if (attempts === 0) return 0
  if (!priced) return undefined
  return attempts === 1 ? bounds.first : undefined
}

/** Reserves the call's upper cost when the config has a cap, and settles it however the call ends. */
export function admitted<A>(config: AiConfig, modelId: string, priced: boolean, bounds: AttemptBounds, call: (progress: Progress) => Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> {
  const admit = config.admit
  const progress: Progress = { attempts: 0 }
  if (admit === undefined) return call(progress)
  return Effect.gen(function* () {
    const started = Date.now()
    const admission = yield* admit(bounds.total)
    if (admission._tag === 'Blocked') return { _tag: 'NoDecision', reason: 'budget', detail: admission.reason ?? 'cap', meta: { model: modelId, latencyMillis: Date.now() - started, attempts: 0 } } as Decision<A>
    return yield* call(progress).pipe(Effect.onExit((exit) =>
      admission.settle(exit._tag === 'Success' ? settledUsd(exit.value, priced, bounds) : stoppedUsd(priced, bounds, progress.attempts))))
  })
}
