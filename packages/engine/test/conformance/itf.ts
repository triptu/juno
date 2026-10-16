/**
 * Reads the ITF traces Quint writes (`--out-itf`): integers come as
 * `{ "#bigint": "1" }`, sets as `{ "#set": [...] }`, maps as
 * `{ "#map": [[k, v], ...] }` and tuples as `{ "#tup": [...] }`.
 * https://apalache-mc.org/docs/adr/015adr-trace.html
 */
import { readFileSync } from 'node:fs'

export type Value = number | string | boolean | ReadonlyArray<Value> | ReadonlySet<Value> | ReadonlyMap<Value, Value> | { readonly [key: string]: Value }

export function decode(raw: unknown): Value {
  if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') return raw
  if (Array.isArray(raw)) return raw.map(decode)
  if (raw === null || typeof raw !== 'object') throw new Error(`not an ITF value: ${String(raw)}`)
  const record = raw as Record<string, unknown>
  if ('#bigint' in record) return Number(record['#bigint'])
  if ('#set' in record) return new Set((record['#set'] as ReadonlyArray<unknown>).map(decode))
  if ('#map' in record) return new Map((record['#map'] as ReadonlyArray<[unknown, unknown]>).map(([k, v]) => [decode(k), decode(v)]))
  if ('#tup' in record) return (record['#tup'] as ReadonlyArray<unknown>).map(decode)
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, decode(value)]))
}

/** One state of a trace: its variables by their short names (`outbox::s` is `s`), and `picks`, the nondeterministic choices of the step into it (`--mbt`). */
export type TraceState = Readonly<Record<string, Value>>

export interface Trace {
  readonly file: string
  readonly states: ReadonlyArray<TraceState>
}

export function readTrace(file: string): Trace {
  const json = JSON.parse(readFileSync(file, 'utf8')) as { states: ReadonlyArray<Record<string, unknown>> }
  const states = json.states.map((state) =>
    Object.fromEntries(
      Object.entries(state)
        .filter(([name]) => name !== '#meta' && name !== 'mbt::actionTaken')
        .map(([name, value]) => [name === 'mbt::nondetPicks' ? 'picks' : name.split('::').at(-1)!, decode(value)]),
    ),
  )
  return { file, states }
}
