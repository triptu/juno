/**
 * Notification settings, hours and presence (spec section 14, inventory
 * section 13). How one message is decided is in `notificationDecision.ts`.
 */
import { hourLabel } from './time'

/** 0 is Sunday, as `Date.prototype.getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** A moment in the owner's local time. */
export interface LocalTime {
  readonly weekday: Weekday
  /** Minutes since local midnight. */
  readonly minutes: number
}

/**
 * Hours on some days of the week. `to` may be before `from` to cross
 * midnight; the span then belongs to the day it starts on. Equal `from` and
 * `to` means no hours.
 */
export interface Hours {
  readonly days: ReadonlyArray<Weekday>
  readonly from: number
  readonly to: number
}

/** A stored Notify me level. Auto is the default and is not stored. */
export type NotifyLevel = 'always' | 'never'

/** Whether any applicable Never level mutes a topic after Always overrides it. */
export function notificationIsMuted(...levels: ReadonlyArray<NotifyLevel | undefined>): boolean {
  return !levels.includes('always') && levels.includes('never')
}

/**
 * A stored level as it reads now. Before 2026-10-23 Always was stored as
 * `every`; `matters`, nothing or anything else is Auto.
 */
export function readLevel(stored: unknown): NotifyLevel | undefined {
  return stored === 'always' || stored === 'every' ? 'always' : stored === 'never' ? 'never' : undefined
}

/** The five Always notify switches. Each notifies inside the hours without Juno's reading. */
export interface AlwaysNotify {
  readonly dms: boolean
  readonly groupDms: boolean
  /** The owner, the owner's groups, @here and @channel. */
  readonly mentions: boolean
  /** Every reply in a thread the owner started. On whenever `followedThreads` is on. */
  readonly startedThreads: boolean
  /** Every reply in a thread the owner follows. */
  readonly followedThreads: boolean
}

export const defaultAlwaysNotify: AlwaysNotify = { dms: false, groupDms: false, mentions: true, startedThreads: false, followedThreads: false }

/** The switches as they apply: the defaults under what is stored, and Threads you started inside Threads you follow. */
export function alwaysNotifyOf(settings: NotificationSettings): AlwaysNotify {
  const switches = { ...defaultAlwaysNotify, ...settings.alwaysNotify }
  return switches.followedThreads ? { ...switches, startedThreads: true } : switches
}

/** One of Your instructions. `notify` is Notify me, `stay` is Don't notify. */
export interface Instruction {
  readonly id: string
  readonly direction: 'notify' | 'stay'
  readonly text: string
}

export interface NotificationSettings {
  /** When the Mac (and Slack's own schedule) may notify. */
  readonly notificationHours: Hours
  /** When Slack shows the owner as active. Outside them, away. */
  readonly presenceHours: Hours
  /** By channel or DM id. */
  readonly channels: Readonly<Record<string, NotifyLevel>>
  /** By user id. */
  readonly people: Readonly<Record<string, NotifyLevel>>
  /** By thread topic id. Missing means no thread overrides. */
  readonly threads?: Readonly<Record<string, NotifyLevel>>
  /** Missing switches take their defaults. */
  readonly alwaysNotify?: Partial<AlwaysNotify>
  /** Your instructions, read with every message on Auto. Missing means none. */
  readonly instructions?: ReadonlyArray<Instruction>
  /** What matters to you, from before instructions. Kept as stored and never read. */
  readonly matters?: string
  /** Ring for huddles: an incoming huddle that would ring plays its sound. Missing means on. */
  readonly huddleRing?: boolean
}

const weekdays: ReadonlyArray<Weekday> = [1, 2, 3, 4, 5]

export const defaultNotificationSettings: NotificationSettings = {
  notificationHours: { days: weekdays, from: 9 * 60, to: 19 * 60 },
  presenceHours: { days: weekdays, from: 9 * 60, to: 19 * 60 },
  channels: {},
  people: {},
}

const DAY = 24 * 60

function weekdayAfter(weekday: Weekday, days: number): Weekday {
  return ((((weekday + days) % 7) + 7) % 7) as Weekday
}

/** Whether `at` falls inside `hours`. */
export function inHours(at: LocalTime, hours: Hours): boolean {
  const { from, to, days } = hours
  if (from === to) return false
  const m = ((at.minutes % DAY) + DAY) % DAY
  if (from < to) return days.includes(at.weekday) && m >= from && m < to
  return (days.includes(at.weekday) && m >= from) || (days.includes(weekdayAfter(at.weekday, -1)) && m < to)
}

function shift(at: LocalTime, minutes: number): LocalTime {
  const total = at.minutes + minutes
  return { weekday: weekdayAfter(at.weekday, Math.floor(total / DAY)), minutes: ((total % DAY) + DAY) % DAY }
}

export interface Switch {
  /** True when hours start at the switch, false when they end. */
  readonly starts: boolean
  /** Minutes from `at` until the switch. */
  readonly inMinutes: number
  readonly at: LocalTime
}

/** The next time `hours` start or end after `at`, within a week. Undefined when they never change. */
export function nextSwitch(at: LocalTime, hours: Hours): Switch | undefined {
  const inside = inHours(at, hours)
  const offsets: number[] = []
  for (let day = 0; day <= 7; day++) {
    for (const boundary of [hours.from, hours.to]) {
      const offset = day * DAY + boundary - at.minutes
      if (offset > 0) offsets.push(offset)
    }
  }
  for (const offset of offsets.toSorted((a, b) => a - b)) {
    const then = shift(at, offset)
    if (inHours(then, hours) !== inside) return { starts: !inside, inMinutes: offset, at: then }
  }
  return undefined
}

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function until(at: LocalTime, inMinutes: number, then: LocalTime): string {
  const time = hourLabel(then.minutes)
  const daysAhead = Math.floor((at.minutes + inMinutes) / DAY)
  if (daysAhead === 0) return `until ${time}`
  if (daysAhead === 1) return `until tomorrow ${time}`
  return `until ${dayNames[then.weekday]} ${time}`
}

/** "until 9am", "until tomorrow 9am", "until Mon 9am": for "Away until 9am" and "Paused until 9am". */
export function untilLabel(at: LocalTime, hours: Hours): string | undefined {
  const next = nextSwitch(at, hours)
  return next === undefined ? undefined : until(at, next.inMinutes, next.at)
}

/** The next time `hours` start (`starts`) or end after `at`, within a week. */
function nextBoundary(at: LocalTime, hours: Hours, starts: boolean): Switch | undefined {
  const first = nextSwitch(at, hours)
  if (first === undefined || first.starts === starts) return first
  const second = nextSwitch(first.at, hours)
  return second === undefined ? undefined : { ...second, inMinutes: first.inMinutes + second.inMinutes }
}

/**
 * The avatar menu's status line (inventory 2.1): "Active", "Away until
 * 9am", or "Active until 8pm" when a change by hand runs past the end of
 * the active hours. `presence` is what Slack shows now.
 */
export function presenceLabel(at: LocalTime, presence: Presence, presenceHours: Hours): string {
  if (presence === 'active' && scheduledPresence(at, presenceHours) === 'active') return 'Active'
  const next = nextBoundary(at, presenceHours, presence === 'away')
  const name = presence === 'active' ? 'Active' : 'Away'
  return next === undefined ? name : `${name} ${until(at, next.inMinutes, next.at)}`
}

/**
 * The avatar menu's second sentence when your presence setting and what
 * Slack shows colleagues differ (SPEC 14, "Your own dot"): "Slack shows
 * you away", or "Connecting to Slack" while Slack has not said, which the
 * dot shows as away. Nothing when they agree.
 */
export function seenNote(setting: Presence, seen: Presence | undefined): string | undefined {
  if (seen === undefined) return setting === 'active' ? 'Connecting to Slack' : undefined
  return seen === setting ? undefined : `Slack shows you ${seen}`
}

/** The avatar menu's hint on Notifications: "Paused until 9am" outside notification hours, nothing inside. */
export function pausedLabel(at: LocalTime, notificationHours: Hours): string | undefined {
  if (inHours(at, notificationHours)) return undefined
  const next = nextBoundary(at, notificationHours, true)
  return next === undefined ? 'Paused' : `Paused ${until(at, next.inMinutes, next.at)}`
}

export type Presence = 'active' | 'away'

/** What the presence schedule says for `at`. The engine applies it at each switch, on launch and on wake. */
export function scheduledPresence(at: LocalTime, presenceHours: Hours): Presence {
  return inHours(at, presenceHours) ? 'active' : 'away'
}

const calendarWeekdays: ReadonlyArray<Weekday> = [0, 1, 2, 3, 4, 5, 6]
export function localTime(at: number): LocalTime {
  const date = new Date(at)
  return { weekday: calendarWeekdays[date.getDay()] ?? 0, minutes: date.getHours() * 60 + date.getMinutes() }
}

/** Calendar arithmetic preserves local hour boundaries across daylight saving changes. */
export function nextHoursStart(at: number, hours: Hours): number | undefined {
  if (hours.from === hours.to) return undefined
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(at)
    date.setDate(date.getDate() + offset)
    date.setHours(Math.floor(hours.from / 60), hours.from % 60, 0, 0)
    if (date.getTime() > at && hours.days.includes(localTime(date.getTime()).weekday)) return date.getTime()
  }
  return undefined
}

/** What an incoming huddle may do (SPEC 20, "Incoming huddles"): ring and notify, or show its card quietly. */
export type HuddleAlertDecision = 'ring' | 'quiet'

/**
 * How a huddle someone started may interrupt (SPEC 20, "Incoming huddles"):
 * by the notification hours and the levels, as a message is, but never by
 * the Always notify switches or Juno's reading, and an ignored conversation
 * does not hold it. Outside the hours it shows the card without a ring or
 * an OS notification; inside, Always rings, Never stays quiet, otherwise it
 * rings.
 */
export function decideHuddleAlert(
  huddle: { readonly channelId: string; readonly startedBy: string; readonly at: LocalTime },
  settings: NotificationSettings,
): HuddleAlertDecision {
  if (!inHours(huddle.at, settings.notificationHours)) return 'quiet'
  const levels = [settings.channels[huddle.channelId], settings.people[huddle.startedBy]]
  return levels.includes('always') || !levels.includes('never') ? 'ring' : 'quiet'
}
