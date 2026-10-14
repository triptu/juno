/**
 * Notifications and presence (spec section 14, inventory section 13).
 *
 * Order: ignored channel → Every message (channel or person) → Never →
 * outside notification hours (into the summary when hours start, if it
 * would have notified) → AI assist off (DMs and mentions) → Juno's judgement.
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
  readonly channel: ChannelInfo
  readonly senderId: UserId
  readonly mentionsMe: boolean
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
 * - summary: no notification now; counted in the one notification when notification hours start.
 * - hold: no notification. The message is in Juno as always.
 */
export type NotificationOutcome = 'now' | 'summary' | 'hold'

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

/** "until 9am", "until tomorrow 9am", "until Mon 9am": for "Away until 9am" and "Paused until 9am". */
export function untilLabel(at: LocalTime, hours: Hours): string | undefined {
  const next = nextSwitch(at, hours)
  if (!next) return undefined
  const time = hourLabel(next.at.minutes)
  const daysAhead = Math.floor((at.minutes + next.inMinutes) / DAY)
  if (daysAhead === 0) return `until ${time}`
  if (daysAhead === 1) return `until tomorrow ${time}`
  return `until ${dayNames[next.at.weekday]} ${time}`
}

export type Presence = 'active' | 'away'

/** What the presence schedule says for `at`. The engine applies it at each switch, on launch and on wake. */
export function scheduledPresence(at: LocalTime, presenceHours: Hours): Presence {
  return inHours(at, presenceHours) ? 'active' : 'away'
}

/** Slack's `presence.set` value. Active is `auto`, so Slack still shows an idle owner as away. */
export function slackPresence(presence: Presence): 'auto' | 'away' {
  return presence === 'active' ? 'auto' : 'away'
}

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
  const { channel, senderId } = candidate
  const where = channelLabel(channel)
  if (channel.ignored) return { outcome: 'hold', reason: `${where} is ignored` }

  const channelLevel = settings.channels[channel.id]
  const personLevel = settings.people[senderId]
  const person = context.userName?.(senderId) ?? senderId
  if (channelLevel === 'every') return { outcome: 'now', reason: `${where} is set to Every message` }
  if (personLevel === 'every') return { outcome: 'now', reason: `${person} is set to Every message` }
  if (channelLevel === 'never') return { outcome: 'hold', reason: `${where} is set to Never` }
  if (personLevel === 'never') return { outcome: 'hold', reason: `${person} is set to Never` }

  const inside = inHours(candidate.at, settings.notificationHours)
  const later = (decision: NotificationDecision): NotificationDecision =>
    inside || decision.outcome !== 'now' ? decision : { outcome: 'summary', reason: `Outside your notification hours. ${decision.reason}` }

  if (!context.aiAssist) {
    const direct = isDm(channel.kind) || candidate.mentionsMe
    return later(
      direct
        ? { outcome: 'now', reason: 'AI assist is off, and DMs and mentions notify you' }
        : { outcome: 'hold', reason: 'AI assist is off, so only DMs and mentions notify you' },
    )
  }

  if (!judgement) return { needsJudgement: true }
  return later({ outcome: judgement.notify ? 'now' : 'hold', reason: `Juno: ${judgement.reason}` })
}

/** The one notification when notification hours start, or nothing when no message was kept for it. */
export function hoursStartSummary(
  held: ReadonlyArray<{ readonly decision: NotificationDecision; readonly where: string }>,
): { readonly title: string; readonly body: string } | undefined {
  const kept = held.filter((item) => item.decision.outcome === 'summary')
  if (kept.length === 0) return undefined
  const places = [...new Set(kept.map((item) => item.where))]
  const shown = places.slice(0, 3)
  const rest = places.length - shown.length
  const list = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0]
  const title = kept.length === 1 ? '1 message needs you' : `${kept.length} messages need you`
  return { title, body: `In ${list}` }
}
