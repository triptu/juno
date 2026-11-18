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

/**
 * Numeric order of two timestamps. Throws on malformed input. Past leading
 * zeros, a longer ts has more whole seconds, and two of the same length
 * compare character by character, the fraction always being six digits.
 * Sorting calls this often, so it reads characters rather than matching.
 */
export function compareTs(a: string, b: string): -1 | 0 | 1 {
  const fromA = significantStart(a)
  const fromB = significantStart(b)
  const length = a.length - fromA
  if (length !== b.length - fromB) return length < b.length - fromB ? -1 : 1
  for (let at = 0; at < length; at++) {
    const charA = a.charCodeAt(fromA + at)
    const charB = b.charCodeAt(fromB + at)
    if (charA !== charB) return charA < charB ? -1 : 1
  }
  return 0
}

/** Where a ts's whole seconds start past leading zeros, keeping one digit. Throws unless it is `<digits>.<6 digits>`. */
function significantStart(ts: string): number {
  const dot = ts.length - 7
  if (dot < 1 || ts.charCodeAt(dot) !== 46) throw new Error(`Not a Slack ts: ${JSON.stringify(ts)}`)
  for (let at = 0; at < ts.length; at++) {
    const char = ts.charCodeAt(at)
    if (at !== dot && (char < 48 || char > 57)) throw new Error(`Not a Slack ts: ${JSON.stringify(ts)}`)
  }
  let start = 0
  while (start < dot - 1 && ts.charCodeAt(start) === 48) start++
  return start
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

/**
 * Builds a ts from a time. `sequence` (0..999) fills the last digits so several ts can share one millisecond.
 * A time with a fraction of a millisecond, such as a Slack ts times 1000, is floored to a whole microsecond.
 */
export function millisToTs(millis: number, sequence = 0): Ts {
  const seconds = Math.floor(millis / 1000)
  const micros = Math.floor((millis - seconds * 1000) * 1000) + sequence
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
