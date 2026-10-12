/**
 * The notification decision (spec section 14, inventory section 13).
 *
 * Order: ignored channel → rules top to bottom, first match wins → quiet
 * hours (digest, unless a rule said Now) → Juno off (digest) → score vs
 * threshold (now) → chatter (silent) → digest.
 */
import { channelLabel, type ChannelInfo } from './channel'
import type { UserId } from './ids'
import { hourLabel } from './time'

export type NotificationOutcome = 'now' | 'digest' | 'silent'
export type RuleKind = 'person' | 'channel' | 'mention' | 'keyword'

export interface NotificationRule {
  readonly id: string
  readonly kind: RuleKind
  /** A user id, a channel id, or the keyword. */
  readonly value: string
  readonly action: NotificationOutcome
}

export interface QuietHours {
  /** Start, in minutes since local midnight. */
  readonly from: number
  /** End, in minutes since local midnight. May be before `from` to cross midnight. */
  readonly to: number
}

export interface NotificationSettings {
  /** "Let Juno decide". Off sends everything without a rule to digest. */
  readonly aiGate: boolean
  /** Percent, 50 to 95. */
  readonly threshold: number
  readonly quietHours?: QuietHours
  /** Minutes since local midnight, for example [600, 780, 990]. */
  readonly digestTimes: ReadonlyArray<number>
}

export const defaultNotificationSettings: NotificationSettings = {
  aiGate: true,
  threshold: 80,
  quietHours: { from: 19 * 60, to: 8 * 60 },
  digestTimes: [10 * 60, 13 * 60, 16 * 60 + 30],
}

export interface NotificationCandidate {
  readonly channel: ChannelInfo
  readonly senderId: UserId
  readonly mentionsMe: boolean
  /** Plain text of the message, for keyword rules. */
  readonly text: string
  /** Minutes since local midnight when it arrived. */
  readonly localMinutes: number
}

/** Juno's read of a message, both in 0..1. */
export interface UrgencyScore {
  readonly urgent: number
  readonly chatter: number
}

/** Above this, a message is "just chatter" and stays silent. */
export const CHATTER_CUTOFF = 0.5

export interface NotificationDecision {
  readonly outcome: NotificationOutcome
  /** Human-readable, for the Today log: "Rule: In #incidents", "Juno · 89% urgent". */
  readonly reason: string
  readonly ruleId?: string
}

export type DecisionResult = NotificationDecision | { readonly needsScore: true }

export interface RuleNames {
  readonly user?: (id: string) => string | undefined
  readonly channel?: (id: string) => ChannelInfo | undefined
}

/** "In #incidents", "From Maya Chen", "Mentions of me in hiring", 'Contains "lunch"'. */
export function ruleLabel(rule: NotificationRule, names: RuleNames = {}): string {
  switch (rule.kind) {
    case 'person':
      return `From ${names.user?.(rule.value) ?? rule.value}`
    case 'channel': {
      const channel = names.channel?.(rule.value)
      return `In ${channel ? channelLabel(channel) : rule.value}`
    }
    case 'mention': {
      const channel = names.channel?.(rule.value)
      return `Mentions of me in ${channel ? channelLabel(channel).replace(/^#/, '') : rule.value}`
    }
    case 'keyword':
      return `Contains "${rule.value}"`
  }
}

export function ruleMatches(rule: NotificationRule, candidate: NotificationCandidate): boolean {
  switch (rule.kind) {
    case 'person':
      return candidate.senderId === rule.value
    case 'channel':
      return candidate.channel.id === rule.value
    case 'mention':
      return candidate.mentionsMe && candidate.channel.id === rule.value
    case 'keyword': {
      const keyword = rule.value.trim().toLowerCase()
      return keyword.length > 0 && candidate.text.toLowerCase().includes(keyword)
    }
  }
}

export function firstMatchingRule(rules: ReadonlyArray<NotificationRule>, candidate: NotificationCandidate): NotificationRule | undefined {
  return rules.find((rule) => ruleMatches(rule, candidate))
}

/** Whether `minutes` falls in the quiet window. Equal `from` and `to` means no quiet hours. */
export function inQuietHours(minutes: number, quiet: QuietHours | undefined): boolean {
  if (!quiet || quiet.from === quiet.to) return false
  const m = ((minutes % 1440) + 1440) % 1440
  return quiet.from < quiet.to ? m >= quiet.from && m < quiet.to : m >= quiet.from || m < quiet.to
}

function percent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100)
}

/**
 * Decides what happens to one incoming message. When the answer depends on
 * Juno's score and none was given, it returns `{ needsScore: true }`; the
 * caller fetches the score and calls again with it.
 */
export function decideNotification(
  candidate: NotificationCandidate,
  rules: ReadonlyArray<NotificationRule>,
  settings: NotificationSettings,
  names: RuleNames = {},
  score?: UrgencyScore,
): DecisionResult {
  if (candidate.channel.ignored) return { outcome: 'silent', reason: 'Ignored channel' }

  const rule = firstMatchingRule(rules, candidate)
  if (rule) return { outcome: rule.action, reason: `Rule: ${ruleLabel(rule, names)}`, ruleId: rule.id }

  if (inQuietHours(candidate.localMinutes, settings.quietHours)) return { outcome: 'digest', reason: 'Quiet hours' }

  if (!settings.aiGate) return { outcome: 'digest', reason: 'Juno off, waiting for digest' }

  if (!score) return { needsScore: true }

  const urgent = percent(score.urgent)
  if (urgent >= settings.threshold) return { outcome: 'now', reason: `Juno · ${urgent}% urgent` }
  if (score.chatter > CHATTER_CUTOFF) return { outcome: 'silent', reason: `Juno · ${percent(score.chatter)}% just chatter` }
  return { outcome: 'digest', reason: `Juno · ${urgent}% urgent, can wait` }
}

/** The next digest slot at or after `minutes`, as minutes since local midnight; wraps to the next day. */
export function nextDigestSlot(minutes: number, digestTimes: ReadonlyArray<number>): { readonly minutes: number; readonly tomorrow: boolean } | undefined {
  const slots = digestTimes.toSorted((a, b) => a - b)
  const first = slots[0]
  if (first === undefined) return undefined
  const later = slots.find((slot) => slot > minutes)
  return later === undefined ? { minutes: first, tomorrow: true } : { minutes: later, tomorrow: false }
}

/** "Next digest 3pm" or "Next digest tomorrow 10am", for the avatar menu hint. */
export function nextDigestLabel(minutes: number, digestTimes: ReadonlyArray<number>): string | undefined {
  const slot = nextDigestSlot(minutes, digestTimes)
  if (!slot) return undefined
  return slot.tomorrow ? `Next digest tomorrow ${hourLabel(slot.minutes)}` : `Next digest ${hourLabel(slot.minutes)}`
}

/** The decision chip in the Today log: "Now", the digest time, or "Silent". */
export function decisionChip(decision: NotificationDecision, digestSlotMinutes?: number): string {
  switch (decision.outcome) {
    case 'now':
      return 'Now'
    case 'silent':
      return 'Silent'
    case 'digest':
      return digestSlotMinutes === undefined ? 'Digest' : hourLabel(digestSlotMinutes)
  }
}
