/**
 * Pure helpers for Slack timestamps (`"<seconds>.<6 digits>"`).
 *
 * A ts is a string, never a float: the fraction is a sequence number, not a
 * precise time, and two messages in the same second differ only there. Compare
 * them as two integers, never as JavaScript numbers.
 */

const TS = /^(\d+)\.(\d+)$/

export function isTs(value: string): boolean {
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

export function maxTs(a: string, b: string): string {
  return compareTs(a, b) >= 0 ? a : b
}

export function minTs(a: string, b: string): string {
  return compareTs(a, b) <= 0 ? a : b
}

/** Whole milliseconds. Good enough for display and ordering by time, not for identity. */
export function tsToMillis(ts: string): number {
  const [seconds, fraction] = splitTs(ts)
  return seconds * 1000 + Math.floor(fraction / 1000)
}

/** Builds a ts from a time. `sequence` fills the last digits so several ts can share one second. */
export function millisToTs(millis: number, sequence = 0): string {
  const seconds = Math.floor(millis / 1000)
  const micros = (millis - seconds * 1000) * 1000 + sequence
  return `${seconds}.${String(micros).padStart(6, '0')}`
}

/** Slack permalink path for a message: `/archives/<channel>/p<ts without dot>`, plus the thread for replies. */
export function permalinkPath(channel: string, ts: string, threadTs?: string): string {
  const base = `/archives/${channel}/p${ts.replace('.', '')}`
  return threadTs !== undefined && threadTs !== ts ? `${base}?thread_ts=${threadTs}&cid=${channel}` : base
}

function splitTs(ts: string): [number, number] {
  const match = TS.exec(ts)
  if (match === null) throw new Error(`Not a Slack ts: ${JSON.stringify(ts)}`)
  const seconds = Number(match[1])
  // Normalise the fraction to six digits so "1.5" and "1.500000" compare equal.
  const fraction = Number((match[2] ?? '').padEnd(6, '0').slice(0, 6))
  return [seconds, fraction]
}
