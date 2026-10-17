/**
 * Notifications and presence (spec section 14, inventory section 13).
 *
 * Order: ignored channel, unless the message mentions the owner directly
 * → Every message (channel or person) → Never → outside notification hours
 * (hold) → AI assist off (DMs and mentions) → Juno's judgement.
 * Every message wins over Never, so nothing important is silently lost.
 */
import { channelLabel, isDm, type ChannelInfo } from './channel'
import type { UserId } from './ids'
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

/** "When it matters" is the default and is not stored. */
export type NotifyLevel = 'every' | 'never'

export interface NotificationSettings {
  /** When the Mac (and Slack's own schedule) may notify. */
  readonly notificationHours: Hours
  /** When Slack shows the owner as active. Outside them, away. */
  readonly presenceHours: Hours
  /** "What matters to you": the owner's words, read by Juno's judgement with every message. */
  readonly matters: string
  /** By channel or DM id. */
  readonly channels: Readonly<Record<string, NotifyLevel>>
  /** By user id. */
  readonly people: Readonly<Record<string, NotifyLevel>>
  /** By thread topic id. Missing means no thread overrides. */
  readonly threads?: Readonly<Record<string, NotifyLevel>>
}

const weekdays: ReadonlyArray<Weekday> = [1, 2, 3, 4, 5]

export const defaultNotificationSettings: NotificationSettings = {
  notificationHours: { days: weekdays, from: 9 * 60, to: 19 * 60 },
  presenceHours: { days: weekdays, from: 9 * 60, to: 19 * 60 },
  matters: '',
  channels: {},
  people: {},
}

export interface NotificationCandidate {
  readonly topicId?: string
  readonly channel: ChannelInfo
  readonly senderId: UserId
  readonly mentionsMe: boolean
  /**
   * A mention of the owner by name or of a user group they are in, not
   * @here or @channel (`messageMentionsMeDirectly`). It breaks through an
   * ignored channel.
   */
  readonly mentionsMeDirectly?: boolean
  readonly at: LocalTime
}

/** Juno's read of one message: whether it needs the owner now, and why in a few words. */
export interface Judgement {
  readonly notify: boolean
  /** "asks you to approve the release before 2pm". */
  readonly reason: string
}

/**
 * - now: an OS notification right away.
 * - hold: no notification. The message is in Juno as always.
 */
export type NotificationOutcome = 'now' | 'hold'

export interface NotificationDecision {
  readonly outcome: NotificationOutcome
  /** For "Why did this notify?": "#incidents is set to Every message", "Juno: asks you to decide". */
  readonly reason: string
}

export type DecisionResult = NotificationDecision | { readonly needsJudgement: true }

export interface DecisionContext {
  /** The global AI assist switch. Off: DMs and mentions notify. */
  readonly aiAssist: boolean
  /** Display names for people, for reasons. */
  readonly userName?: (id: string) => string | undefined
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

/** What a Notify me choice applies to: a thread topic id, a channel or DM id, or a user id. */
export interface NotifyTarget {
  readonly kind: 'thread' | 'channel' | 'person'
  readonly id: string
}

/**
 * What decided a message, for the why popover (inventory 15.4): a Notify
 * me level offers Change on that thread, channel or person; the hours offer
 * Change on the Notifications page; Juno's call offers Tell Juno.
 */
export type DecisionCause =
  | { readonly kind: 'level'; readonly target: NotifyTarget }
  | { readonly kind: 'hours' }
  | { readonly kind: 'juno' }
  | { readonly kind: 'ignored' }
  | { readonly kind: 'aiOff' }

export type CausedDecision = { readonly decision: NotificationDecision; readonly cause: DecisionCause } | { readonly needsJudgement: true }

/**
 * Decides what happens to one incoming message. When the answer depends on
 * Juno's judgement and none was given, it returns `{ needsJudgement: true }`;
 * the caller asks Juno (with `settings.matters`) and calls again.
 */
export function decideNotification(
  candidate: NotificationCandidate,
  settings: NotificationSettings,
  context: DecisionContext,
  judgement?: Judgement,
): DecisionResult {
  const result = decideWithCause(candidate, settings, context, judgement)
  return 'needsJudgement' in result ? result : result.decision
}

function level(kind: NotifyTarget['kind'], id: string, outcome: NotificationOutcome, reason: string): CausedDecision {
  return { decision: { outcome, reason }, cause: { kind: 'level', target: { kind, id } } }
}

/** `decideNotification`, with what decided it. */
export function decideWithCause(
  candidate: NotificationCandidate,
  settings: NotificationSettings,
  context: DecisionContext,
  judgement?: Judgement,
): CausedDecision {
  const { channel, senderId } = candidate
  const where = channelLabel(channel)
  // An ignored channel never notifies, except to say someone needs the owner by name: that goes on through the settings.
  if (channel.ignored && candidate.mentionsMeDirectly !== true) return { decision: { outcome: 'hold', reason: `${where} is ignored` }, cause: { kind: 'ignored' } }

  const thread = candidate.topicId?.startsWith('t:') ? candidate.topicId : undefined
  const threadLevel = thread === undefined ? undefined : settings.threads?.[thread]
  const channelLevel = settings.channels[channel.id]
  const personLevel = settings.people[senderId]
  const person = context.userName?.(senderId) ?? senderId
  if (thread !== undefined && threadLevel === 'every') return level('thread', thread, 'now', 'This thread is set to Every message')
  if (channelLevel === 'every') return level('channel', channel.id, 'now', `${where} is set to Every message`)
  if (personLevel === 'every') return level('person', senderId, 'now', `${person} is set to Every message`)
  if (thread !== undefined && threadLevel === 'never') return level('thread', thread, 'hold', 'This thread is set to Never')
  if (channelLevel === 'never') return level('channel', channel.id, 'hold', `${where} is set to Never`)
  if (personLevel === 'never') return level('person', senderId, 'hold', `${person} is set to Never`)

  const inside = inHours(candidate.at, settings.notificationHours)
  const later = (decision: NotificationDecision, cause: DecisionCause): CausedDecision =>
    inside || decision.outcome !== 'now'
      ? { decision, cause }
      : { decision: { outcome: 'hold', reason: `Outside your notification hours. ${decision.reason}` }, cause: { kind: 'hours' } }

  if (!context.aiAssist) {
    const direct = isDm(channel.kind) || candidate.mentionsMe
    return later(
      direct
        ? { outcome: 'now', reason: 'AI assist is off, and DMs and mentions notify you' }
        : { outcome: 'hold', reason: 'AI assist is off, so only DMs and mentions notify you' },
      { kind: 'aiOff' },
    )
  }

  if (!judgement) return { needsJudgement: true }
  return later({ outcome: judgement.notify ? 'now' : 'hold', reason: `Juno: ${judgement.reason}` }, { kind: 'juno' })
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
