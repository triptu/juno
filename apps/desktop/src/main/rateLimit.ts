/**
 * When a file host answers 429, its `Retry-After` is kept per host and
 * every request for that host is refused here until it passes, so a
 * picture's retries (`packages/views/src/pictureLoad.ts`) never reach Slack
 * while it asks for a pause. Pure, so it tests without Electron.
 */

/** The pause when a 429 names none, or one that cannot be read. */
const DEFAULT_PAUSE_MS = 10_000
/** The longest pause honoured; a stray date far ahead must not refuse a host for the rest of the run. */
const MAX_PAUSE_MS = 5 * 60_000

/** `Retry-After` as milliseconds from `now`: seconds, or an HTTP date; the default when absent or unreadable; never over the cap. */
export function retryAfterMillis(header: string | null, now: number): number {
  if (header === null) return DEFAULT_PAUSE_MS
  const text = header.trim()
  const seconds = /^\d+$/.test(text) ? Number(text) : undefined
  const millis = seconds !== undefined ? seconds * 1000 : Date.parse(text) - now
  if (!Number.isFinite(millis) || millis <= 0) return DEFAULT_PAUSE_MS
  return Math.min(millis, MAX_PAUSE_MS)
}

/** The hosts asked to pause, each until a time. */
export class HostPauses {
  readonly #until = new Map<string, number>()

  /** Records a 429's `Retry-After` for `host`. */
  pause(host: string, retryAfter: string | null, now: number): void {
    this.#until.set(host, now + retryAfterMillis(retryAfter, now))
  }

  /** How long `host` is still to be left alone, in whole seconds, or undefined when it may be asked. */
  remainingSeconds(host: string, now: number): number | undefined {
    const until = this.#until.get(host)
    if (until === undefined) return undefined
    if (until <= now) {
      this.#until.delete(host)
      return undefined
    }
    return Math.ceil((until - now) / 1000)
  }
}
