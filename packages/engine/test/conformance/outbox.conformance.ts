// Replays the outbox traces Quint generated (`pnpm specs:conformance`)
// against the engine and the fake Slack. See README, "Conformance".
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTrace, type Trace } from './itf'
import { outboxSpec } from './outbox'
import { explain, json, replay } from './replay'

const dir = join(import.meta.dirname, '../../../../specs/traces/conformance')
interface Entry {
  readonly file: string
  readonly kind: 'random' | 'corrected' | 'bug'
  /** For a bug trace: its corrected schedule's trace. */
  readonly corrected?: string
  /** Why the harness cannot drive it. */
  readonly skip?: string
}
const manifest = join(dir, 'outbox.json')
const entries: ReadonlyArray<Entry> = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')) as ReadonlyArray<Entry>) : []
const only = process.env['CONFORMANCE_ONLY']
const selected = only === undefined ? entries : entries.filter((entry) => entry.file.includes(only))

/**
 * A random trace stops after a fixed number of steps, maybe while Juno
 * still has steps of its own to take, which the engine then takes. It is
 * replayed up to the last state before a step of the world, where Juno had
 * nothing left to do.
 */
function settled(trace: Trace): Trace {
  let end = trace.states.length - 1
  while (end > 0 && trace.states[end]!['by'] !== 'world') end--
  return { ...trace, states: trace.states.slice(0, Math.max(1, end)) }
}

/** The first state of the bug trace that its corrected trace does not share. */
function fork(bug: Trace, corrected: Trace): number {
  const same = (i: number) => json(bug.states[i]?.['s']) === json(corrected.states[i]?.['s'])
  let i = 0
  while (i < bug.states.length && same(i)) i++
  return i
}

describe.concurrent('outbox conformance', () => {
  it('has traces', () => {
    expect(entries.length, 'run pnpm specs:conformance, which generates them first').toBeGreaterThan(0)
  })
  for (const entry of selected) {
    if (entry.skip !== undefined) {
      it.skip(`${entry.file}: ${entry.skip}`, () => {})
      continue
    }
    const trace = readTrace(join(dir, entry.file))
    if (entry.kind === 'bug') {
      it(`refuses ${entry.file}`, async () => {
        const corrected = readTrace(join(dir, entry.corrected!))
        const at = fork(trace, corrected)
        const outcome = await replay(outboxSpec, trace, { roundMs: 8_000 })
        if (outcome.ok) throw new Error(`the engine followed the broken schedule ${entry.file}`)
        // It must leave the schedule where the bug does. Earlier is fine only when the engine is
        // already in a state the corrected schedule reaches after the fork (Juno's own steps ran ahead).
        const early = outcome.to < at && corrected.states.slice(at).some((_, i) => json(outcome.actual) === json(outboxSpec.expected(corrected.states, at + i)))
        if (!(outcome.from <= at && at <= outcome.to) && !early) throw new Error(`diverged before the bug, which is at step ${at}:\n${explain(trace, outcome)}`)
      })
    } else {
      it(`follows ${entry.file}`, async () => {
        const replayed = entry.kind === 'random' ? settled(trace) : trace
        const outcome = await replay(outboxSpec, replayed)
        if (!outcome.ok) throw new Error(explain(replayed, outcome))
      })
    }
  }
})
