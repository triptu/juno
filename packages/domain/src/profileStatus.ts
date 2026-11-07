/**
 * A person's Slack status (SPEC 14, "Your status"): an emoji and a short
 * text, with an optional time it clears at. These are the rules the status
 * sheet and the engine share: Slack's preset statuses, the "Clear after"
 * choices and when each ends, and the "until" line.
 *
 * Times are local, as Slack's client works them out (research section 3,
 * "Profile status"): Today ends at 23:59:59, This week at the end of Friday.
 */
import { untilPhrase } from './time'

/** Slack's limit on the text, in characters. */
export const STATUS_TEXT_MAX = 100

/** Slack's emoji for a status with text and no emoji chosen. */
export const STATUS_DEFAULT_EMOJI = 'speech_balloon'

export type StatusClearAfter = 'never' | '30m' | '1h' | '4h' | 'today' | 'week'

/** The "Clear after" choices, in Slack's order. */
export const STATUS_CLEAR_AFTER: ReadonlyArray<{ readonly value: StatusClearAfter; readonly label: string }> = [
  { value: 'never', label: 'Don’t clear' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
]

export interface StatusPreset {
  /** The emoji's name, without colons. */
  readonly emoji: string
  readonly text: string
  readonly clearAfter: StatusClearAfter
}

/** Slack's default presets, with the emoji and the clear time each sets. */
export const STATUS_PRESETS: ReadonlyArray<StatusPreset> = [
  { emoji: 'spiral_calendar_pad', text: 'In a meeting', clearAfter: '1h' },
  { emoji: 'bus', text: 'Commuting', clearAfter: '30m' },
  { emoji: 'face_with_thermometer', text: 'Out sick', clearAfter: 'today' },
  { emoji: 'palm_tree', text: 'Vacationing', clearAfter: 'never' },
  { emoji: 'house_with_garden', text: 'Working remotely', clearAfter: 'today' },
]

const MINUTE = 60_000

/** The end of `at`'s local day, 23:59:59, in epoch milliseconds. */
function endOfDay(at: Date, daysAhead = 0): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + daysAhead, 23, 59, 59).getTime()
}

/**
 * When a status set at `now` with `choice` clears, in epoch seconds; 0 for
 * never, as Slack's `status_expiration` has it. This week ends on Friday;
 * set on a Saturday or Sunday, it ends that Sunday.
 */
export function statusExpiry(choice: StatusClearAfter, now: Date): number {
  const at = (() => {
    switch (choice) {
      case 'never':
        return 0
      case '30m':
        return now.getTime() + 30 * MINUTE
      case '1h':
        return now.getTime() + 60 * MINUTE
      case '4h':
        return now.getTime() + 240 * MINUTE
      case 'today':
        return endOfDay(now)
      case 'week': {
        const day = now.getDay()
        return endOfDay(now, day === 6 ? 1 : day === 0 ? 0 : 5 - day)
      }
    }
  })()
  return Math.floor(at / 1000)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** When a status clears, seen from `now`, in local time (`untilPhrase`). */
export function statusUntil(expiresAt: number, now: Date): string {
  const then = new Date(expiresAt)
  // The last moment it covers, so one that clears at midnight dates the day before.
  const last = new Date(expiresAt - 1)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = new Date(then.getFullYear(), then.getMonth(), then.getDate())
  return untilPhrase({
    daysAhead: Math.round((day.getTime() - today.getTime()) / (24 * 60 * MINUTE)),
    weekday: then.getDay(),
    minutes: then.getHours() * 60 + then.getMinutes(),
    date: `${MONTHS[last.getMonth()]!} ${last.getDate()}`,
  })
}
