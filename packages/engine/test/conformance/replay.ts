/**
 * Replays a Quint trace against the engine (README, "Conformance").
 *
 * A trace is cut into rounds. A round is one step the harness drives (a
 * send, Slack's answer, a socket drop, another client's change) followed by
 * the steps Juno takes on its own after it (a claim, a lookup, the
 * catch-up). The harness drives the first step, then waits until the
 * engine's projection equals the model's projection of the state at the
 * end of the round, and stays equal for `STABLE_MS`. A round that never
 * gets there is a divergence: the engine and the model disagree.
 */
import { sleep } from '../harness'
import type { Trace, TraceState } from './itf'

/** How long a round may take. Covers Juno's timers: a lookup after 2 s, backoff after refusals (a copy's delete waits up to 16 s by its fifth), a socket reconnect. */
export const ROUND_MS = 35_000
/** How long the projections must stay equal before the round counts as reached. */
const STABLE_MS = 300

export interface Spec<W, V> {
  /** Starts the engine and the fake for this trace. */
  readonly start: (trace: Trace) => Promise<W>
  readonly stop: (world: W) => Promise<void>
  /** Whether the step from `prev` to `next` is Juno's own, which the harness waits for instead of driving. */
  readonly own: (world: W, prev: TraceState, next: TraceState) => boolean
  /** Drives a step that is not Juno's own. Throws when the engine is not in a state where it can happen. */
  readonly perform: (world: W, prev: TraceState, next: TraceState) => Promise<void>
  /** The model's projection of `states[index]`; earlier states are there for what the state alone does not say. */
  readonly expected: (states: ReadonlyArray<TraceState>, index: number) => V
  /** The same projection, read from the engine and the fake. */
  readonly observe: (world: W) => Promise<V> | V
  /** How long a round of these steps may take, when not `ROUND_MS`. */
  readonly roundMs?: (steps: ReadonlyArray<TraceState>) => number | undefined
  /** What else to print about the engine and the fake at a divergence. */
  readonly debug?: (world: W) => string
}

export interface Divergence {
  /** The first and last step of the round that was not reached. */
  readonly from: number
  readonly to: number
  readonly steps: ReadonlyArray<string>
  readonly reason: string
  readonly expected?: unknown
  readonly actual?: unknown
  readonly debug?: string
}

export type Outcome = { readonly ok: true; readonly rounds: number } | ({ readonly ok: false } & Divergence)

const label = (state: TraceState) => {
  const s = state['s'] as { label: string; target: number }
  return `${s.label}(${s.target})`
}

export const json = (value: unknown) => JSON.stringify(value, (_, v: unknown) => (v instanceof Set ? [...v].toSorted() : v instanceof Map ? Object.fromEntries(v) : v))

/** Replays `trace` and answers where it diverged, if it did. */
export async function replay<W, V>(spec: Spec<W, V>, trace: Trace, options: { readonly roundMs?: number } = {}): Promise<Outcome> {
  const { states } = trace
  const world = await spec.start(trace)
  let rounds = 0
  const end = (from: number) => {
    let to = from
    while (to + 1 < states.length && spec.own(world, states[to]!, states[to + 1]!)) to += 1
    return to
  }
  const steps = (from: number, to: number) => states.slice(from, to + 1).map(label)
  const settle = async (from: number, to: number): Promise<Divergence | undefined> => {
    const expected = spec.expected(states, to)
    const want = json(expected)
    const started = Date.now()
    const roundMs = options.roundMs ?? spec.roundMs?.(states.slice(from, to + 1)) ?? ROUND_MS
    let since: number | undefined
    let actual: V | undefined
    while (Date.now() - started < roundMs) {
      actual = await spec.observe(world)
      if (json(actual) === want) {
        since ??= Date.now()
        if (Date.now() - since >= STABLE_MS) return undefined
      } else since = undefined
      await sleep(25)
    }
    return { from, to, steps: steps(from, to), reason: 'the engine did not reach the model state', expected, actual, ...(spec.debug === undefined ? {} : { debug: spec.debug(world) }) }
  }
  try {
    let at = end(0)
    const first = await settle(0, at)
    if (first !== undefined) return { ok: false, ...first }
    while (at + 1 < states.length) {
      const from = at + 1
      try {
        await spec.perform(world, states[at]!, states[from]!)
      } catch (error) {
        return { ok: false, from, to: from, steps: steps(from, from), reason: `could not drive the step: ${error instanceof Error ? error.message : String(error)}` }
      }
      at = end(from)
      const diverged = await settle(from, at)
      if (diverged !== undefined) return { ok: false, ...diverged }
      rounds += 1
    }
    return { ok: true, rounds }
  } finally {
    await spec.stop(world)
  }
}

/** A divergence as a few readable lines, with only the fields that differ. */
export function explain(trace: Trace, outcome: Divergence): string {
  const lines = [`${trace.file}: steps ${outcome.from}-${outcome.to} (${outcome.steps.join(' ')}): ${outcome.reason}`]
  if (outcome.expected !== undefined) {
    const expected = JSON.parse(json(outcome.expected)) as Record<string, unknown>
    const actual = JSON.parse(json(outcome.actual ?? {})) as Record<string, unknown>
    for (const key of Object.keys(expected)) {
      if (json(expected[key]) !== json(actual[key])) lines.push(`  ${key}: model ${json(expected[key])}, engine ${json(actual[key])}`)
    }
  }
  if (outcome.debug !== undefined) lines.push(outcome.debug)
  return lines.join('\n')
}
