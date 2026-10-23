/**
 * Tells the engine the owner is at the Mac, so Slack shows them active
 * (docs/research/slack-data-access.md section 3, Presence). Every 10 s, as
 * the official desktop app does, while the Mac's idle time is at most
 * 10 minutes (the official app: 20 s) and the screen is not locked, main
 * sends `active`. The engine then sends
 * a socket `tickle`, paced and skipped while the owner is away. An idle or
 * locked Mac sends nothing, so Slack's own timeout shows the owner away.
 *
 * No Electron import here: `index.ts` passes `powerMonitor`'s pieces in,
 * tests pass a seam.
 */
import type { MainToEngine } from '@juno/contract'

/** How often the idle time is read. The official app: 10 s. */
export const POLL_MS = 10_000

/** In use when the last input was at most this long ago. The official app uses 20 s; Juno keeps the owner active longer on purpose. */
export const ACTIVE_WITHIN_SECONDS = 10 * 60

export interface ActivityWatchDeps {
  /** `powerMonitor.getSystemIdleTime()`: seconds since the last keyboard or mouse input. */
  readonly idleSeconds: () => number
  /** Whether the screen is locked, from `lock-screen` and `unlock-screen`. */
  readonly locked: () => boolean
  /** To the engine over parentPort. */
  readonly send: (message: MainToEngine) => void
}

export function createActivityWatch(deps: ActivityWatchDeps) {
  let timer: ReturnType<typeof setInterval> | undefined
  const poll = () => {
    if (!deps.locked() && deps.idleSeconds() <= ACTIVE_WITHIN_SECONDS) deps.send({ _tag: 'active' })
  }
  return {
    /** Reads once now, then every `POLL_MS`, until `stop`. */
    start(): void {
      if (timer !== undefined) return
      poll()
      timer = setInterval(poll, POLL_MS)
      timer.unref()
    },
    stop(): void {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
    poll,
  }
}
