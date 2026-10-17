/**
 * Slack's own notification schedule (its Do Not Disturb hours) from Juno's
 * notification hours (spec section 14). The schedule is a set of user prefs,
 * read with `users.prefs.get` and written with `users.prefs.set`
 * (docs/research/slack-data-access.md section 7).
 *
 * Slack names the pause, Juno the hours that notify: `dnd_end_hour` is when
 * notifications start and `dnd_start_hour` when they stop. Per day, used when
 * `dnd_days` is `custom`, `dnd_before_<day>` is the start, `dnd_after_<day>`
 * the stop, and `dnd_enabled_<day>` is `partial` (those hours), `all_day`
 * (no notifications) or `disabled` (no pause).
 */
import type { Hours, Weekday } from './notifications'

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

const sameDays = (days: ReadonlyArray<Weekday>, wanted: ReadonlyArray<Weekday>) =>
  days.length === wanted.length && wanted.every((day) => days.includes(day))

/**
 * The prefs that make Slack pause outside `hours`. Every day and Monday to
 * Friday use Slack's `every_day` and `weekdays`; any other set of days, and
 * no hours at all, use `custom`. Slack's per-day hours cannot cross
 * midnight, so on custom days a span that does stops at 23:59.
 */
export function slackScheduleFor(hours: Hours): SlackSchedulePrefs {
  const { days, from, to } = hours
  if (from !== to && sameDays(days, [0, 1, 2, 3, 4, 5, 6])) {
    return { dnd_enabled: true, dnd_days: 'every_day', dnd_start_hour: clock(to), dnd_end_hour: clock(from) }
  }
  if (from !== to && sameDays(days, [1, 2, 3, 4, 5])) {
    return { dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: clock(to), dnd_end_hour: clock(from) }
  }
  const prefs: Record<string, string | boolean> = { dnd_enabled: true, dnd_days: 'custom' }
  for (const [index, day] of dayNames.entries()) {
    if (from === to || !days.includes(index as Weekday)) {
      prefs[`dnd_enabled_${day}`] = 'all_day'
      continue
    }
    prefs[`dnd_enabled_${day}`] = 'partial'
    prefs[`dnd_before_${day}`] = clock(from)
    prefs[`dnd_after_${day}`] = from < to ? clock(to) : '23:59'
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
