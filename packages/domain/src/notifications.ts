/**
 * Notifications and presence (spec section 14, inventory section 13).
 *
 * Every candidate message either notifies (a banner) or stays (unread in
 * Juno). The first step that applies decides: notification hours, Always,
 * Never or an ignored channel (a direct mention gets through), the Always
 * notify switches, AI assist off, then Auto: a closer, a live conversation,
 * Juno's reading. A banner then holds the conversation quiet for a minute.
 */
import { channelLabel, firstName, isDm, type ChannelInfo } from './channel'
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

/** What the store knows about the conversation when a message arrives. Missing facts count as false. */
export interface ConversationFacts {
  /** Minutes since the owner last wrote in this topic. */
  readonly ownerWroteMinutesAgo?: number
  /** The owner wrote the message before this one in the topic. */
  readonly ownerWroteLast?: boolean
  readonly ownerStartedThread?: boolean
  /** The owner follows the thread in Slack. */
  readonly followed?: boolean
  /** Seconds since Juno's last banner for this topic. */
  readonly bannerSecondsAgo?: number
}

export interface NotificationCandidate {
  readonly topicId?: string
  readonly channel: ChannelInfo
  readonly senderId: UserId
  readonly mentionsMe: boolean
  /**
   * A mention of the owner by name or of a user group they are in, not
   * @here or @channel (`messageMentionsMeDirectly`). It gets through Never
   * and an ignored channel.
   */
  readonly mentionsMeDirectly?: boolean
  readonly text?: string
  readonly facts?: ConversationFacts
  readonly at: LocalTime
}

/** The options of the reading's `needsYou` question, the first five of which need the owner. */
export const needsYouOptions = ['ask', 'answer', 'follow_up', 'decision', 'serious', 'greeting', 'fyi', 'chatter'] as const
export type NeedsYou = (typeof needsYouOptions)[number]
const needsOwner: ReadonlyArray<NeedsYou> = ['ask', 'answer', 'follow_up', 'decision', 'serious']

/** Juno's reading of one message: the classifier's answers as they came, before any threshold. */
export interface Reading {
  readonly needsYou: NeedsYou
  readonly probabilities: Readonly<Partial<Record<NeedsYou, number>>>
  /** The instruction the message's main point matches, when one was chosen over none. */
  readonly instruction?: { readonly id: string; readonly confidence: number }
}

/** Set later from replay labels. */
export const INSTRUCTION_NOTIFY_CONFIDENCE = 0.7
export const INSTRUCTION_STAY_CONFIDENCE = 0.85
/** The sum of the needs-the-owner probabilities at which a reading notifies. */
export const NEEDS_YOU_THRESHOLD = 0.5
/** The owner wrote in the topic this recently: it is a live conversation. */
export const LIVE_MINUTES = 10
/** After a banner, the same topic does not notify again for this long. */
export const BURST_SECONDS = 60

export type NotificationOutcome = 'notify' | 'stay'
export type DecidedBy =
  | 'hours' | 'always' | 'never' | 'ignored' | 'directMention' | 'alwaysNotify' | 'aiOff'
  | 'closer' | 'live' | 'instruction' | 'reading' | 'timeout' | 'burst'

/** What a Notify me choice applies to: a thread topic id, a channel or DM id, or a user id. */
export interface NotifyTarget {
  readonly kind: 'thread' | 'channel' | 'person'
  readonly id: string
}

export interface NotificationDecision {
  readonly outcome: NotificationOutcome
  readonly decidedBy: DecidedBy
  /** One line from facts and the chosen option: "#design is set to Always.", "Sam asks you something." */
  readonly reason: string
  /** The level that decided it, for Change. */
  readonly target?: NotifyTarget
  /** The instruction that decided it, for Edit instructions. */
  readonly instructionId?: string
}

export interface DecisionContext {
  /** The global AI assist switch. Off: DMs and mentions notify, the rest stays. */
  readonly aiAssist: boolean
  /** Display names for people, for reasons. */
  readonly userName?: (id: string) => string | undefined
}

const CLOSERS = new Set(['thanks', 'thank you', 'ty', 'thx', 'got it', 'ok', 'okay', 'k', 'cool', 'great', 'perfect', 'sounds good', 'will do', 'np', 'no worries'])
const THANKS = new Set(['thanks', 'thank you', 'ty', 'thx'])
const EMOJI_ONLY = /^(?:\s|:[a-z0-9_+-]+:|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f)+$/u

/** The text without case, outer space or trailing punctuation. */
const plain = (text: string) => text.trim().toLowerCase().replace(/[\s.!,;:)]+$/u, '')

/**
 * Whether a message is only a closer: one of a short fixed list, or emoji
 * only, at most three words. "thanks, can you approve?" is not one.
 */
export function isCloser(text: string): boolean {
  const words = text.trim().split(/\s+/).filter((word) => word !== '')
  if (words.length === 0 || words.length > 3) return false
  return CLOSERS.has(plain(text)) || EMOJI_ONLY.test(text.trim())
}

/**
 * Decides one incoming message. When Auto reaches Juno's reading and none
 * was given, it returns `{ needsReading: true }`; the caller reads the
 * message and calls again. `'failed'` is a reading that did not come in
 * time or failed: DMs and mentions notify, the rest stays.
 */
export function decideNotification(
  candidate: NotificationCandidate,
  settings: NotificationSettings,
  context: DecisionContext,
  reading?: Reading | 'failed',
): NotificationDecision | { readonly needsReading: true } {
  const decision = decideOnce(candidate, settings, context, reading)
  if ('needsReading' in decision || decision.outcome === 'stay') return decision
  const since = candidate.facts?.bannerSecondsAgo
  return since !== undefined && since < BURST_SECONDS
    ? { outcome: 'stay', decidedBy: 'burst', reason: 'Juno notified you about this conversation less than a minute ago.' }
    : decision
}

function decideOnce(
  candidate: NotificationCandidate,
  settings: NotificationSettings,
  context: DecisionContext,
  reading: Reading | 'failed' | undefined,
): NotificationDecision | { readonly needsReading: true } {
  const { channel, senderId, facts = {} } = candidate
  const where = channelLabel(channel)
  const name = context.userName?.(senderId)
  const first = name === undefined ? 'Someone' : firstName(name)
  if (!inHours(candidate.at, settings.notificationHours)) return { outcome: 'stay', decidedBy: 'hours', reason: 'Outside your notification hours.' }

  const thread = candidate.topicId?.startsWith('t:') ? candidate.topicId : undefined
  const levels: ReadonlyArray<{ readonly target: NotifyTarget; readonly level: NotifyLevel | undefined; readonly name: string }> = [
    ...(thread === undefined ? [] : [{ target: { kind: 'thread', id: thread } as const, level: settings.threads?.[thread], name: 'This thread' }]),
    { target: { kind: 'channel', id: channel.id }, level: settings.channels[channel.id], name: where },
    { target: { kind: 'person', id: senderId }, level: settings.people[senderId], name: name ?? senderId },
  ]
  const always = levels.find((entry) => entry.level === 'always')
  if (always !== undefined) return { outcome: 'notify', decidedBy: 'always', reason: `${always.name} is set to Always.`, target: always.target }
  const never = levels.find((entry) => entry.level === 'never')
  if (never !== undefined || channel.ignored) {
    const through = never !== undefined ? 'Never' : 'ignored channels'
    if (candidate.mentionsMeDirectly === true) return { outcome: 'notify', decidedBy: 'directMention', reason: `Mentions you by name. That gets through ${through}.` }
    return never !== undefined
      ? { outcome: 'stay', decidedBy: 'never', reason: `${never.name} is set to Never.`, target: never.target }
      : { outcome: 'stay', decidedBy: 'ignored', reason: `${where} is ignored.` }
  }

  const switches = alwaysNotifyOf(settings)
  const switched = (reason: string): NotificationDecision => ({ outcome: 'notify', decidedBy: 'alwaysNotify', reason })
  if (switches.dms && channel.kind === 'im') return switched('Direct messages always notify.')
  if (switches.groupDms && channel.kind === 'mpim') return switched('Group DMs always notify.')
  if (switches.mentions && candidate.mentionsMe) return switched('Mentions always notify.')
  if (thread !== undefined && switches.startedThreads && facts.ownerStartedThread === true) return switched('A reply in a thread you started.')
  if (thread !== undefined && switches.followedThreads && facts.followed === true) return switched('A reply in a thread you follow.')

  const direct = isDm(channel.kind) || candidate.mentionsMe
  if (!context.aiAssist) {
    return direct
      ? { outcome: 'notify', decidedBy: 'aiOff', reason: 'AI assist is off. Direct messages and mentions notify.' }
      : { outcome: 'stay', decidedBy: 'aiOff', reason: 'AI assist is off. Only direct messages and mentions notify.' }
  }

  if (facts.ownerWroteLast === true && isCloser(candidate.text ?? '')) {
    const said = THANKS.has(plain(candidate.text ?? '')) ? 'thanked you' : 'closed the conversation'
    return { outcome: 'stay', decidedBy: 'closer', reason: `${first} ${said}. Nothing to do.` }
  }
  const minutes = facts.ownerWroteMinutesAgo
  if (minutes !== undefined && minutes <= LIVE_MINUTES) {
    const ago = minutes < 1 ? 'just now' : minutes < 2 ? 'a minute ago' : `${Math.floor(minutes)} minutes ago`
    return { outcome: 'notify', decidedBy: 'live', reason: `You were talking with ${first} ${ago}.` }
  }

  if (reading === undefined) return { needsReading: true }
  if (reading === 'failed') return { outcome: direct ? 'notify' : 'stay', decidedBy: 'timeout', reason: "Juno couldn't read this in time." }
  const chosen = reading.instruction === undefined ? undefined : settings.instructions?.find((item) => item.id === reading.instruction?.id)
  if (chosen !== undefined && reading.instruction !== undefined) {
    const enough = chosen.direction === 'notify' ? INSTRUCTION_NOTIFY_CONFIDENCE : INSTRUCTION_STAY_CONFIDENCE
    if (reading.instruction.confidence >= enough) {
      return {
        outcome: chosen.direction,
        decidedBy: 'instruction',
        reason: `Your instructions: ${chosen.direction === 'notify' ? 'Notify me' : "Don't notify"}: ${chosen.text}`,
        instructionId: chosen.id,
      }
    }
  }
  const p = (option: NeedsYou) => reading.probabilities[option] ?? 0
  const notify = needsOwner.reduce((sum, option) => sum + p(option), 0) >= NEEDS_YOU_THRESHOLD
  // The reason names the likeliest option on the side that won.
  const side = needsYouOptions.filter((option) => needsOwner.includes(option) === notify)
  const named = side.includes(reading.needsYou) ? reading.needsYou : side.reduce((best, option) => (p(option) > p(best) ? option : best))
  const place = isDm(channel.kind) ? '' : ` in ${where}`
  const reasons: Record<NeedsYou, string> = {
    ask: `${first} asks you something.`,
    answer: `${first} answered your question.`,
    follow_up: `${first} is following up, and you haven't replied.`,
    decision: `A decision is being made${place}.`,
    serious: `Something serious${place}, and you're part of it.`,
    greeting: `${first} said hello. Nothing asked yet.`,
    fyi: 'An update with nothing asked of you.',
    chatter: "Talk you're not part of.",
  }
  return { outcome: notify ? 'notify' : 'stay', decidedBy: 'reading', reason: reasons[named] }
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
