/**
 * Notification settings, hours and presence (spec section 14, inventory
 * section 13). How one message is decided is in `notificationDecision.ts`.
 */
import { untilPhrase } from './time'

/** 0 is Sunday, as `Date.prototype.getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** A moment in the owner's local time. */
export interface LocalTime {
  readonly weekday: Weekday
  /** Minutes since local midnight. */
  readonly minutes: number
}

/** A from and to time in minutes since local midnight. */
export interface Span {
  readonly from: number
  readonly to: number
}

/** One day's own hours, on a day whose hours differ from the shared ones. */
export interface DayHours extends Span {
  readonly day: Weekday
}

/**
 * Hours on some days of the week, as Slack's Custom schedule: each day is
 * off or has its own from and to. `days` are the days with hours, `from`
 * and `to` their shared hours, and `dayHours` the days whose hours differ.
 * Hours saved before 2026-10-24 have no `dayHours`. `to` may be before
 * `from` to cross midnight; the span then belongs to the day it starts on.
 * Equal `from` and `to` means no hours that day.
 */
export interface Hours extends Span {
  readonly days: ReadonlyArray<Weekday>
  readonly dayHours?: ReadonlyArray<DayHours>
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
  /**
   * When the Mac (and Slack's own schedule) may notify; undefined pauses nothing. As saved, undefined until the
   * owner sets them, and then Slack's own schedule is in effect (`readSettings` in `@juno/notifications`).
   */
  readonly notificationHours?: Hours
  /**
   * When Slack shows the owner as active, outside them away, while `awayOutsideHours` is on. Undefined until the
   * owner sets them: Slack's automatic mode.
   */
  readonly presenceHours?: Hours
  /** Set me away outside active hours. Missing means off: Juno never sets the owner away, and the hours are kept. */
  readonly awayOutsideHours?: boolean
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
  /**
   * When Slack's snooze ends (Pause notifications), in epoch milliseconds. Never saved: present only while a snooze
   * runs at the time the settings were read (`readSettings` in `@juno/notifications`), so a reader that has it is
   * paused now.
   */
  readonly snoozedUntil?: number
}

const weekdays: ReadonlyArray<Weekday> = [1, 2, 3, 4, 5]
const allWeekdays: ReadonlyArray<Weekday> = [0, 1, 2, 3, 4, 5, 6]

/** Neither set of hours is set until the owner sets it (SPEC 14). */
export const defaultNotificationSettings: NotificationSettings = { channels: {}, people: {} }

/** Monday to Friday, 9am to 7pm: what the rows start from when the owner first sets hours that were not set. */
export const startingHours: Hours = { days: weekdays, from: 9 * 60, to: 19 * 60 }

const DAY = 24 * 60

function weekdayAfter(weekday: Weekday, days: number): Weekday {
  return ((((weekday + days) % 7) + 7) % 7) as Weekday
}

/** The hours on `day`: its own when it has them, else the shared ones. Undefined on a day without hours. */
export function hoursOn(hours: Hours, day: Weekday): Span | undefined {
  if (!hours.days.includes(day)) return undefined
  const { from, to } = hours.dayHours?.find((own) => own.day === day) ?? hours
  return from === to ? undefined : { from, to }
}

/** Whether two sets of hours give every day the same hours. */
export function sameHours(a: Hours, b: Hours): boolean {
  return allWeekdays.every((day) => {
    const left = hoursOn(a, day)
    const right = hoursOn(b, day)
    return left?.from === right?.from && left?.to === right?.to
  })
}

/**
 * Hours as they are saved: a day keeps its own hours only while it has
 * hours that differ from the shared ones, and once every day with hours
 * has the same hours they become the shared ones.
 */
export function normalHours(hours: Hours): Hours {
  const own = (hours.dayHours ?? []).filter(
    (each, index, all) => hours.days.includes(each.day) && all.findLastIndex((other) => other.day === each.day) === index,
  )
  const spans = hours.days.map((day) => own.find((each) => each.day === day) ?? hours)
  const first = spans[0] ?? hours
  const shared = spans.every((span) => span.from === first.from && span.to === first.to) ? first : hours
  const differ = own.filter((each) => each.from !== shared.from || each.to !== shared.to)
  const base = { days: hours.days, from: shared.from, to: shared.to }
  return differ.length === 0 ? base : { ...base, dayHours: differ.toSorted((a, b) => a.day - b.day).map(({ day, from, to }) => ({ day, from, to })) }
}

/** The three rows of hours in Settings: Monday to Friday together, then Saturday and Sunday. */
export type HoursGroup = 'weekdays' | 'saturday' | 'sunday'

const groupDays: Readonly<Record<HoursGroup, ReadonlyArray<Weekday>>> = { weekdays, saturday: [6], sunday: [0] }

/**
 * A row's hours, undefined when it is off. Weekdays read as the hours most
 * of them have, or off when most are off, so hours saved with different
 * weekdays still read as one row; a tie goes to the earlier day.
 */
export function groupHours(hours: Hours, group: HoursGroup): Span | undefined {
  const spans = groupDays[group].map((day) => hoursOn(hours, day))
  const count = (span: Span | undefined) => spans.filter((other) => other?.from === span?.from && other?.to === span?.to).length
  return spans.reduce((best, span) => (count(span) > count(best) ? span : best), spans[0])
}

/**
 * The hours with one row changed. Off takes the row's days out. A from or
 * to gives every day of the row the same hours, the other edge kept from
 * the row, or from the weekdays when the row was off. A change that would
 * leave no time between from and to keeps the row's length instead.
 */
export function withGroupHours(hours: Hours, group: HoursGroup, change: Partial<Span> | 'off'): Hours {
  const days = groupDays[group]
  if (change === 'off') return normalHours({ ...hours, days: hours.days.filter((day) => !days.includes(day)) })
  const base = groupHours(hours, group) ?? groupHours(hours, 'weekdays') ?? hours
  let { from = base.from, to = base.to } = change
  if (from === to) {
    const length = (base.to - base.from + DAY) % DAY || 60
    if (change.from === undefined) from = (to - length + DAY) % DAY
    else to = (from + length) % DAY
  }
  return normalHours({
    ...hours,
    days: allWeekdays.filter((day) => hours.days.includes(day) || days.includes(day)),
    dayHours: [...(hours.dayHours ?? []).filter((own) => !days.includes(own.day)), ...days.map((day) => ({ day, from, to }))],
  })
}

/** Whether `at` falls inside `hours`. A span that crosses midnight belongs to the day it starts on. */
export function inHours(at: LocalTime, hours: Hours): boolean {
  const m = ((at.minutes % DAY) + DAY) % DAY
  const today = hoursOn(hours, at.weekday)
  if (today !== undefined && m >= today.from && (today.from > today.to || m < today.to)) return true
  const yesterday = hoursOn(hours, weekdayAfter(at.weekday, -1))
  return yesterday !== undefined && yesterday.from > yesterday.to && m < yesterday.to
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
  const boundaries = new Set([hours.from, hours.to, ...(hours.dayHours ?? []).flatMap((own) => [own.from, own.to])])
  const offsets: number[] = []
  for (let day = 0; day <= 7; day++) {
    for (const boundary of boundaries) {
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

function until(at: LocalTime, inMinutes: number, then: LocalTime): string {
  return untilPhrase({ daysAhead: Math.floor((at.minutes + inMinutes) / DAY), weekday: then.weekday, minutes: then.minutes })
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
export function presenceLabel(at: LocalTime, presence: Presence, presenceHours: Hours | undefined): string {
  const name = presence === 'active' ? 'Active' : 'Away'
  if (presenceHours === undefined || (presence === 'active' && scheduledPresence(at, presenceHours) === 'active')) return name
  const next = nextBoundary(at, presenceHours, presence === 'away')
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

/** Whether notifications are paused at `at`: outside the notification hours, never when there are none. */
export function notificationsPaused(at: LocalTime, notificationHours: Hours | undefined): boolean {
  return notificationHours !== undefined && !inHours(at, notificationHours)
}

/**
 * When notifications come back after `now` (epoch milliseconds): the first time neither a snooze nor the time
 * outside notification hours holds them. Undefined when they are not paused now; null when the hours never start.
 */
export function pausedUntil(now: number, notificationHours: Hours | undefined, snoozedUntil: number | undefined): number | null | undefined {
  let at = now
  // A snooze can end outside the hours and the hours can end inside a snooze; each step moves past one of them.
  for (let step = 0; step < 4; step++) {
    if (snoozedUntil !== undefined && at < snoozedUntil) at = snoozedUntil
    else if (notificationHours !== undefined && !inHours(localTime(at), notificationHours)) {
      const start = nextHoursStart(at, notificationHours)
      if (start === undefined) return null
      at = start
    } else break
  }
  return at === now ? undefined : at
}

/**
 * The avatar menu's hint on Notifications while they are paused, by the notification hours or Slack's snooze:
 * "Paused until 9am", "Paused until tomorrow 9am", "Paused until Mon 9am". Nothing while they are not.
 */
export function pausedLabel(now: number, notificationHours: Hours | undefined, snoozedUntil?: number): string | undefined {
  const end = pausedUntil(now, notificationHours, snoozedUntil)
  if (end === undefined) return undefined
  if (end === null) return 'Paused'
  const { days, time, day } = endParts(now, end)
  if (days === 0) return `Paused until ${time}`
  if (days === 1) return `Paused until tomorrow ${time}`
  return `Paused until ${day} ${time}`
}

/** A time `end` after `now` (epoch milliseconds) in local time: days ahead by the calendar, "9am", and "Mon". */
export function endParts(now: number, end: number): { readonly days: number; readonly time: string; readonly day: string } {
  const from = new Date(now)
  const to = new Date(end)
  const days = Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime() - new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) / 86_400_000)
  return { days, time: hourLabel(to.getHours() * 60 + to.getMinutes()), day: dayNames[to.getDay()] as string }
}

export type Presence = 'active' | 'away'

/** The active hours as they set presence: none while Set me away outside active hours is off. */
export function awayHours(settings: Pick<NotificationSettings, 'presenceHours' | 'awayOutsideHours'>): Hours | undefined {
  return settings.awayOutsideHours === true ? settings.presenceHours : undefined
}

/** What the presence schedule says for `at`. The engine applies it at each switch, on launch and on wake. */
export function scheduledPresence(at: LocalTime, presenceHours: Hours): Presence {
  return inHours(at, presenceHours) ? 'active' : 'away'
}

export function localTime(at: number): LocalTime {
  const date = new Date(at)
  return { weekday: allWeekdays[date.getDay()] ?? 0, minutes: date.getHours() * 60 + date.getMinutes() }
}

/** The next time `hours` start after `at`, each day at its own start. Calendar arithmetic preserves local hour boundaries across daylight saving changes. */
export function nextHoursStart(at: number, hours: Hours): number | undefined {
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(at)
    date.setDate(date.getDate() + offset)
    const span = hoursOn(hours, allWeekdays[date.getDay()] ?? 0)
    if (span === undefined) continue
    date.setHours(Math.floor(span.from / 60), span.from % 60, 0, 0)
    if (date.getTime() > at) return date.getTime()
  }
  return undefined
}

/** When `hours` next start or end after `at`, within a week. Minutes are added on the local clock, so a daylight saving change keeps the switch's local time. */
export function nextSwitchTime(at: number, hours: Hours): number | undefined {
  const next = nextSwitch(localTime(at), hours)
  if (next === undefined) return undefined
  const date = new Date(at)
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() + next.inMinutes)
  return date.getTime()
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
  if (settings.snoozedUntil !== undefined || notificationsPaused(huddle.at, settings.notificationHours)) return 'quiet'
  const levels = [settings.channels[huddle.channelId], settings.people[huddle.startedBy]]
  return levels.includes('always') || !levels.includes('never') ? 'ring' : 'quiet'
}
