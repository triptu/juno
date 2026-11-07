/**
 * Time formatting (spec section 17, inventory section 21).
 *
 * Relative time is short and tabular-friendly: a number and a unit with no
 * spaces, or one word. Message times depend on the calendar, so they take a
 * time zone; the default is the runtime's.
 */

const MINUTE = 60_000

/** "now", "4m", "2h", "Yesterday", "3d" (under 14 days), then "2w". */
export function relativeTime(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / MINUTE))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  if (minutes < 2880) return 'Yesterday'
  if (minutes < 20160) return `${Math.floor(minutes / 1440)}d`
  return `${Math.floor(minutes / 10080)}w`
}

export interface TimeOptions {
  readonly timeZone?: string
  readonly locale?: string
}

interface CalendarDay {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly weekday: string
}

function calendarDay(at: number, options: TimeOptions): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: options.timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(new Date(at))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), weekday: get('weekday') }
}

function dayNumber(d: CalendarDay): number {
  // Days since an epoch, good enough for "same day" and "yesterday" checks.
  return Math.floor(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000)
}

/** "9:12" the same day, "Yesterday", the weekday within a week ("Sat"), else "Oct 3" ("Oct 3, 2025" in another year). */
export function messageTime(at: number, now: number, options: TimeOptions = {}): string {
  const then = calendarDay(at, options)
  const today = calendarDay(now, options)
  const diffDays = dayNumber(today) - dayNumber(then)
  if (diffDays === 0) return shortClock(at, options)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays > 1 && diffDays < 7) return then.weekday
  return shortDate(at, then.year === today.year, options)
}

/**
 * A message header's time, which always has the clock: "9:12" the same day,
 * "Yesterday 9:12", "Oct 3, 9:12", and "Oct 3, 2025, 9:12" in another year.
 * Headers repeat after ten quiet minutes, so a date alone would not tell them apart.
 */
export function messageHeaderTime(at: number, now: number, options: TimeOptions = {}): string {
  const then = calendarDay(at, options)
  const today = calendarDay(now, options)
  const diffDays = dayNumber(today) - dayNumber(then)
  const clock = shortClock(at, options)
  if (diffDays === 0) return clock
  if (diffDays === 1) return `Yesterday ${clock}`
  return `${shortDate(at, then.year === today.year, options)}, ${clock}`
}

/** "9:12", "13:45": 24-hour clock without a leading zero. */
function shortClock(at: number, options: TimeOptions): string {
  const parts = new Intl.DateTimeFormat(options.locale ?? 'en-US', { timeZone: options.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${Number(get('hour'))}:${get('minute')}`
}

/** "Oct 3", or "Oct 3, 2025" outside the current year. */
function shortDate(at: number, sameYear: boolean, options: TimeOptions): string {
  return new Intl.DateTimeFormat(options.locale ?? 'en-US', { timeZone: options.timeZone, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(new Date(at))
}

/** "10am", "4:30pm", "12pm" for digest chips and quiet hours. */
export function hourLabel(minutesOfDay: number): string {
  const total = ((Math.round(minutesOfDay) % 1440) + 1440) % 1440
  const h24 = Math.floor(total / 60)
  const m = total % 60
  const suffix = h24 < 12 ? 'am' : 'pm'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** When something ends, as `untilPhrase` reads it. */
export interface UntilParts {
  /** Whole local days from today to the day it ends on. */
  readonly daysAhead: number
  /** That day of the week, 0 for Sunday. */
  readonly weekday: number
  /** Minutes after that day's midnight. */
  readonly minutes: number
  /** "Nov 20": the last day it covers, for an end a week or more away. Without it the weekday is used. */
  readonly date?: string
}

/**
 * "until 5:30pm", "until tomorrow 9am", "until Fri 9am", "until Nov 20 3pm":
 * the one "until" for a status, Away and Paused. An end at 23:59 or at
 * midnight names its day only, and midnight belongs to the day before it:
 * "until today", "until Fri", never "until tomorrow 12am".
 */
export function untilPhrase({ daysAhead, weekday, minutes, date }: UntilParts): string {
  const midnight = minutes === 0 && daysAhead > 0
  const days = midnight ? daysAhead - 1 : daysAhead
  const day = SHORT_DAYS[((midnight ? weekday - 1 : weekday) + 7) % 7]!
  const name = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 || date === undefined ? day : date
  if (midnight || minutes >= 1439) return `until ${name}`
  return days <= 0 ? `until ${hourLabel(minutes)}` : `until ${name} ${hourLabel(minutes)}`
}
