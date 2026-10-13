/**
 * Relative time for row times (SPEC section 17, inventory section 21):
 * "now", "4m", "2h", "Yesterday", "3d" under 14 days, then "2w".
 *
 * The same rule as `relativeTime` in `@juno/domain`, repeated here because
 * views and containers cannot depend on domain (docs/architecture.md section
 * 3). Keep the two in step.
 */
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export function relativeTime(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / MINUTE))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  if (minutes < 2880) return 'Yesterday'
  if (minutes < 20160) return `${Math.floor(minutes / 1440)}d`
  return `${Math.floor(minutes / 10080)}w`
}

const clock = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
const weekday = new Intl.DateTimeFormat('en', { weekday: 'short' })
const monthDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const monthDayYear = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
const full = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })

const startOfDay = (at: number): number => {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * The time next to a message (inventory 6.1 and 21): "9:12" on the same
 * day, "Yesterday", the weekday ("Sat") inside the week, then "Oct 3", with
 * the year once it differs.
 */
export function messageTime(at: number, now: number): string {
  const today = startOfDay(now)
  const day = startOfDay(at)
  if (day === today) return clock.format(at)
  if (day === today - DAY) return 'Yesterday'
  if (day > today - 7 * DAY && day < today) return weekday.format(at)
  return new Date(at).getFullYear() === new Date(now).getFullYear() ? monthDay.format(at) : monthDayYear.format(at)
}

/** The full date and time for a tooltip: "Saturday, October 3, 2026, 9:12". */
export function fullTime(at: number): string {
  return full.format(at)
}

const dateFormats = {
  date_num: new Intl.DateTimeFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit' }),
  date_short: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }),
  date: new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }),
  date_long: new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
  time: clock,
  time_secs: new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
} as const

/** "{date_short}" with "Today" or "Yesterday" instead of the date when it is one. */
function pretty(at: number, now: number, plain: (at: number) => string): string {
  const today = startOfDay(now)
  const day = startOfDay(at)
  if (day === today) return 'Today'
  if (day === today - DAY) return 'Yesterday'
  if (day === today + DAY) return 'Tomorrow'
  return plain(at)
}

/**
 * A Slack `date` element in the reader's time zone: the format string's
 * tokens ("{date_short} at {time}") are replaced one by one. A token Slack
 * adds later stays as written, which is what Slack's own fallback does.
 */
export function slackDate(timestamp: number, format: string, now: number): string {
  const at = timestamp * 1000
  return format.replace(/\{([a-z_]+)\}/g, (token, name: string) => {
    switch (name) {
      case 'date_num':
      case 'date_short':
      case 'date':
      case 'date_long':
      case 'time':
      case 'time_secs':
        return dateFormats[name].format(at)
      case 'date_pretty':
        return pretty(at, now, (value) => dateFormats.date.format(value))
      case 'date_short_pretty':
        return pretty(at, now, (value) => dateFormats.date_short.format(value))
      case 'date_long_pretty':
        return pretty(at, now, (value) => dateFormats.date_long.format(value))
      case 'ago':
        return relativeTime(at, now)
      default:
        return token
    }
  })
}
