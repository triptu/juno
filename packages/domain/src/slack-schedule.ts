/**
 * Slack's own notification schedule (its Do Not Disturb hours) from Juno's
 * notification hours, and the hours it holds while Juno has none of its own
 * (spec section 14). The schedule is a set of user prefs,
 * read with `users.prefs.get` and written with `users.prefs.set`
 * (docs/research/slack-data-access.md section 7).
 *
 * Slack names the pause, Juno the hours that notify: `dnd_end_hour` is when
 * notifications start and `dnd_start_hour` when they stop. Per day, used when
 * `dnd_days` is `custom`, `dnd_before_<day>` is the start, `dnd_after_<day>`
 * the stop, and `dnd_enabled_<day>` is `partial` (those hours), `all_day`
 * (no notifications) or `disabled` (no pause).
 */
import { hoursOn, normalHours, type DayHours, type Hours, type Weekday } from './notifications'

/** The schedule prefs Juno reads and writes, as Slack holds them. */
export type SlackSchedulePrefs = Readonly<Record<string, string | boolean>>

/** Slack's day names, 0 is Sunday, as `Weekday`. */
const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** Every pref that makes up the schedule. */
export const slackScheduleKeys: ReadonlyArray<string> = [
  'dnd_enabled',
  'dnd_days',
  'dnd_start_hour',
  'dnd_end_hour',
  ...dayNames.flatMap((day) => [`dnd_enabled_${day}`, `dnd_before_${day}`, `dnd_after_${day}`]),
]

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Slack sends both `9:00` and `09:00`; its own client pads before comparing. */
const normalTime = (value: string) => (/^\d:\d\d$/.test(value) ? `0${value}` : value)

const sameDays = (days: ReadonlyArray<number>, wanted: ReadonlyArray<number>) =>
  days.length === wanted.length && wanted.every((day) => days.includes(day))

/**
 * The prefs that make Slack pause outside `hours`. When every day with
 * hours has the same hours, every day and Monday to Friday use Slack's
 * `every_day` and `weekdays`; any other days, days with their own hours,
 * and no hours at all use `custom`. Slack's per-day hours cannot cross
 * midnight, so on custom days a span that does stops at 23:59.
 */
export function slackScheduleFor(hours: Hours): SlackSchedulePrefs {
  const spans = dayNames.map((_, day) => hoursOn(hours, day as Weekday))
  const on = spans.flatMap((span, day) => (span === undefined ? [] : [day]))
  const first = spans.find((span) => span !== undefined)
  const shared = first !== undefined && spans.every((span) => span === undefined || (span.from === first.from && span.to === first.to))
  if (shared && sameDays(on, [0, 1, 2, 3, 4, 5, 6])) {
    return { dnd_enabled: true, dnd_days: 'every_day', dnd_start_hour: clock(first.to), dnd_end_hour: clock(first.from) }
  }
  if (shared && sameDays(on, [1, 2, 3, 4, 5])) {
    return { dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: clock(first.to), dnd_end_hour: clock(first.from) }
  }
  const prefs: Record<string, string | boolean> = { dnd_enabled: true, dnd_days: 'custom' }
  for (const [index, day] of dayNames.entries()) {
    const span = spans[index]
    if (span === undefined) {
      prefs[`dnd_enabled_${day}`] = 'all_day'
      continue
    }
    prefs[`dnd_enabled_${day}`] = 'partial'
    prefs[`dnd_before_${day}`] = clock(span.from)
    prefs[`dnd_after_${day}`] = span.from < span.to ? clock(span.to) : '23:59'
  }
  return prefs
}

/** Whether Slack's prefs already hold every value in `target`. */
export function slackScheduleMatches(current: Readonly<Record<string, unknown>>, target: SlackSchedulePrefs): boolean {
  return Object.entries(target).every(([key, value]) => {
    const now = current[key]
    return typeof value === 'string' && typeof now === 'string' ? normalTime(now) === normalTime(value) : now === value
  })
}

/**
 * The schedule prefs Slack holds now, to put back later. A schedule that was
 * never set has no `dnd_enabled`; it is kept as off, so putting it back
 * turns Slack's pause off again.
 */
export function slackScheduleSnapshot(current: Readonly<Record<string, unknown>>): SlackSchedulePrefs {
  const snapshot: Record<string, string | boolean> = { dnd_enabled: false }
  for (const key of slackScheduleKeys) {
    const value = current[key]
    if (typeof value === 'string' || typeof value === 'boolean') snapshot[key] = value
  }
  return snapshot
}

/** Where Slack's page draws a day without a pause to end: 23:59. */
const ALL_DAY_TO = 23 * 60 + 59

/** Minutes since midnight from `H:MM` or `HH:MM`, or undefined for anything else. */
const minutesOf = (value: unknown) => {
  const match = typeof value === 'string' ? /^(\d{1,2}):(\d\d)$/.exec(value) : null
  if (match === null) return undefined
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes < 24 * 60 ? minutes : undefined
}

/**
 * The hours Slack's schedule lets notifications through, or undefined when it
 * pauses nothing: off, never set, or values Juno does not know. `weekdays`
 * pauses the whole weekend. On custom days, `all_day` is a day without hours
 * and `disabled` a day without a pause, which Slack's page draws as 00:00 to
 * 23:59.
 */
export function slackScheduleHours(prefs: Readonly<Record<string, unknown>>): Hours | undefined {
  if (prefs['dnd_enabled'] !== true) return undefined
  const days = prefs['dnd_days']
  if (days === 'every_day' || days === 'weekdays') {
    const from = minutesOf(prefs['dnd_end_hour'])
    const to = minutesOf(prefs['dnd_start_hour'])
    if (from === undefined || to === undefined || from === to) return undefined
    return { days: days === 'every_day' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5], from, to }
  }
  if (days !== 'custom') return undefined
  const own: Array<DayHours> = []
  for (const [index, day] of dayNames.entries()) {
    const weekday = index as Weekday
    const enabled = prefs[`dnd_enabled_${day}`]
    if (enabled === 'all_day') continue
    if (enabled === 'disabled') {
      own.push({ day: weekday, from: 0, to: ALL_DAY_TO })
      continue
    }
    const from = minutesOf(prefs[`dnd_before_${day}`])
    const to = minutesOf(prefs[`dnd_after_${day}`])
    if (enabled !== 'partial' || from === undefined || to === undefined) return undefined
    if (from < to) own.push({ day: weekday, from, to })
  }
  const allDay = (span: DayHours) => span.from === 0 && span.to === ALL_DAY_TO
  if (own.length === 7 && own.every(allDay)) return undefined
  return normalHours({ days: own.map((span) => span.day), from: own[0]?.from ?? 0, to: own[0]?.to ?? 0, dayHours: own })
}
