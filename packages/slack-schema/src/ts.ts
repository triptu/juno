/**
 * The Slack message timestamp, `"<unix seconds>.<6 digits>"`, and its helpers.
 *
 * A ts is a string, never a float: the fraction is a sequence number, not a
 * precise time, and two messages in the same second differ only there. Compare
 * them as two integers, never as JavaScript numbers.
 *
 * This is the one definition of `Ts` in the codebase. `@juno/domain` re-exports it.
 */
import { Schema as S } from 'effect'

const TS = /^(\d+)\.(\d{6})$/

/** A message timestamp. Branded, so a channel id or a plain string cannot be passed as one. */
export const Ts = S.String.check(S.isPattern(TS)).pipe(S.brand('Ts'))
export type Ts = typeof Ts.Type

export function isTs(value: string): value is Ts {
  return TS.test(value)
}

/** Numeric order of two timestamps. Throws on malformed input. */
export function compareTs(a: string, b: string): -1 | 0 | 1 {
  const [as, af] = splitTs(a)
  const [bs, bf] = splitTs(b)
  if (as !== bs) return as < bs ? -1 : 1
  if (af !== bf) return af < bf ? -1 : 1
  return 0
}

export function maxTs<T extends string>(a: T, b: T): T {
  return compareTs(a, b) >= 0 ? a : b
}

export function minTs<T extends string>(a: T, b: T): T {
  return compareTs(a, b) <= 0 ? a : b
}

/** Whole milliseconds. Good enough for display and ordering by time, not for identity. */
export function tsToMillis(ts: string): number {
  const [seconds, fraction] = splitTs(ts)
  return seconds * 1000 + Math.floor(fraction / 1000)
}

/** Builds a ts from a time. `sequence` (0..999) fills the last digits so several ts can share one millisecond. */
export function millisToTs(millis: number, sequence = 0): Ts {
  const seconds = Math.floor(millis / 1000)
  const micros = (millis - seconds * 1000) * 1000 + sequence
  return Ts.make(`${seconds}.${String(micros).padStart(6, '0')}`)
}

/** Slack permalink path for a message: `/archives/<channel>/p<ts without dot>`, plus the thread for replies. */
export function permalinkPath(channel: string, ts: string, threadTs?: string): string {
  const base = `/archives/${channel}/p${ts.replace('.', '')}`
  return threadTs !== undefined && threadTs !== ts ? `${base}?thread_ts=${threadTs}&cid=${channel}` : base
}

function splitTs(ts: string): [number, number] {
  const match = TS.exec(ts)
  if (match === null) throw new Error(`Not a Slack ts: ${JSON.stringify(ts)}`)
  return [Number(match[1]), Number(match[2])]
}
