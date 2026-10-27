/**
 * How one incoming message is decided (spec section 14). It notifies (a
 * banner) or stays (unread in Juno). The first step that applies decides:
 * notification hours, Always, Never or an ignored channel (a direct mention
 * gets through), the Always notify switches, AI assist off, then Auto: a
 * closer, a message addressed to someone else, a live conversation, Juno's
 * reading. A banner then holds the conversation quiet for 10 seconds.
 */
import { channelLabel, firstName, isDm, type ChannelInfo } from './channel'
import type { UserId } from './ids'
import { alwaysNotifyOf, notificationsPaused, type LocalTime, type NotificationSettings, type NotifyLevel } from './notifications'

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
  /** The names of the other people the message mentions by name, in order. */
  readonly mentionsOthers?: ReadonlyArray<string>
  readonly text?: string
  readonly facts?: ConversationFacts
  readonly at: LocalTime
}

/** The options of the reading's `needsYou` question. Which of them count towards notifying depends on the conversation (`counts`). */
export const needsYouOptions = ['ask', 'answer', 'follow_up', 'decision', 'serious', 'greeting', 'fyi', 'chatter'] as const
export type NeedsYou = (typeof needsYouOptions)[number]

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
/** After a banner, the same topic does not notify again for this many seconds; later messages are decided on their own. */
export const BURST_SECONDS = 10

export type NotificationOutcome = 'notify' | 'stay'
export type DecidedBy =
  | 'hours' | 'always' | 'never' | 'ignored' | 'directMention' | 'alwaysNotify' | 'aiOff'
  | 'closer' | 'addressedElsewhere' | 'live' | 'instruction' | 'reading' | 'timeout' | 'burst'

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

const CLOSERS = new Set(['thanks', 'thank you', 'ty', 'thx', 'got it', 'ok', 'okay', 'k', 'sure', 'yep', 'cool', 'great', 'nice', 'perfect', 'sounds good', 'will do', 'np', 'no worries'])
const THANKS = new Set(['thanks', 'thank you', 'ty', 'thx'])
const EMOJI_ONLY = /^(?:\s|:[a-z0-9_+-]+:|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f)+$/u

/** The text without case, outer space or trailing punctuation. */
const plain = (text: string) => text.trim().toLowerCase().replace(/[\s.!?…,;:)]+$/u, '')

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
): NotificationDecision | NeedsReading {
  const decision = decideOnce(candidate, settings, context, reading)
  if ('needsReading' in decision || decision.outcome === 'stay') return decision
  const since = candidate.facts?.bannerSecondsAgo
  return since !== undefined && since < BURST_SECONDS
    ? { outcome: 'stay', decidedBy: 'burst', reason: 'Juno notified you about this conversation a few seconds ago.' }
    : decision
}

export interface NeedsReading {
  readonly needsReading: true
}

/** Who the message is from, as reasons name them. */
interface Names {
  /** "Maya Chen", or the id when the name is unknown. */
  readonly sender: string
  /** "Maya", or "Someone". */
  readonly first: string
  /** "#eng", "Maya Chen". */
  readonly where: string
}

function decideOnce(candidate: NotificationCandidate, settings: NotificationSettings, context: DecisionContext, reading: Reading | 'failed' | undefined): NotificationDecision | NeedsReading {
  if (notificationsPaused(candidate.at, settings.notificationHours)) return { outcome: 'stay', decidedBy: 'hours', reason: 'Outside your notification hours.' }
  const name = context.userName?.(candidate.senderId)
  const names: Names = { sender: name ?? candidate.senderId, first: name === undefined ? 'Someone' : firstName(name), where: channelLabel(candidate.channel) }
  const direct = isDm(candidate.channel.kind) || candidate.mentionsMe
  const byAiOff: NotificationDecision = direct
    ? { outcome: 'notify', decidedBy: 'aiOff', reason: 'AI assist is off. Direct messages and mentions notify.' }
    : { outcome: 'stay', decidedBy: 'aiOff', reason: 'AI assist is off. Only direct messages and mentions notify.' }
  return byLevels(candidate, settings, names)
    ?? bySwitches(candidate, settings)
    ?? (context.aiAssist ? auto(candidate, settings, names, reading) : byAiOff)
}

/** A thread's level: the stored one, else Never when it is known not to be followed, as Notify me shows it (threads set to Never before 2026-10-23 were only unfollowed). */
const threadLevel = (candidate: NotificationCandidate, settings: NotificationSettings, thread: string): NotifyLevel | undefined =>
  settings.threads?.[thread] ?? (candidate.facts?.followed === false ? 'never' : undefined)

const threadOf = (candidate: NotificationCandidate) => (candidate.topicId?.startsWith('t:') ? candidate.topicId : undefined)

/** Always, then Never or an ignored channel, which a direct mention gets through. */
function byLevels(candidate: NotificationCandidate, settings: NotificationSettings, names: Names): NotificationDecision | undefined {
  const { channel, senderId } = candidate
  const thread = threadOf(candidate)
  const levels: ReadonlyArray<{ readonly target: NotifyTarget; readonly level: NotifyLevel | undefined; readonly name: string }> = [
    ...(thread === undefined ? [] : [{ target: { kind: 'thread', id: thread } as const, level: threadLevel(candidate, settings, thread), name: 'This thread' }]),
    { target: { kind: 'channel', id: channel.id }, level: settings.channels[channel.id], name: names.where },
    { target: { kind: 'person', id: senderId }, level: settings.people[senderId], name: names.sender },
  ]
  const always = levels.find((entry) => entry.level === 'always')
  if (always !== undefined) return { outcome: 'notify', decidedBy: 'always', reason: `${always.name} is set to Always.`, target: always.target }
  const never = levels.find((entry) => entry.level === 'never')
  if (never === undefined && channel.ignored !== true) return undefined
  if (candidate.mentionsMeDirectly === true) {
    return { outcome: 'notify', decidedBy: 'directMention', reason: `Mentions you by name. That gets through ${never !== undefined ? 'Never' : 'ignored channels'}.` }
  }
  return never !== undefined
    ? { outcome: 'stay', decidedBy: 'never', reason: `${never.name} is set to Never.`, target: never.target }
    : { outcome: 'stay', decidedBy: 'ignored', reason: `${names.where} is ignored.` }
}

const switched = (reason: string): NotificationDecision => ({ outcome: 'notify', decidedBy: 'alwaysNotify', reason })

/** The Always notify switches. */
function bySwitches(candidate: NotificationCandidate, settings: NotificationSettings): NotificationDecision | undefined {
  const switches = alwaysNotifyOf(settings)
  const { kind } = candidate.channel
  const facts = candidate.facts ?? {}
  const thread = threadOf(candidate) !== undefined
  if (switches.dms && kind === 'im') return switched('Direct messages always notify.')
  if (switches.groupDms && kind === 'mpim') return switched('Group DMs always notify.')
  if (switches.mentions && candidate.mentionsMe) return switched('Mentions always notify.')
  if (thread && switches.startedThreads && facts.ownerStartedThread === true) return switched('A reply in a thread you started.')
  if (thread && switches.followedThreads && facts.followed === true) return switched('A reply in a thread you follow.')
  return undefined
}

/** Auto: a closer, a message addressed to someone else, a live conversation, then Juno's reading. */
function auto(candidate: NotificationCandidate, settings: NotificationSettings, names: Names, reading: Reading | 'failed' | undefined): NotificationDecision | NeedsReading {
  const facts = candidate.facts ?? {}
  const text = candidate.text ?? ''
  if (facts.ownerWroteLast === true && isCloser(text)) {
    return { outcome: 'stay', decidedBy: 'closer', reason: `${names.first} ${THANKS.has(plain(text)) ? 'thanked you' : 'closed the conversation'}. Nothing to do.` }
  }
  const other = candidate.mentionsOthers?.[0]
  if (candidate.channel.kind !== 'im' && other !== undefined && candidate.mentionsMeDirectly !== true) {
    return { outcome: 'stay', decidedBy: 'addressedElsewhere', reason: `Asks ${firstName(other)}, not you.` }
  }
  const minutes = facts.ownerWroteMinutesAgo
  if (minutes !== undefined && minutes <= LIVE_MINUTES) {
    const ago = minutes < 1 ? 'just now' : minutes < 2 ? 'a minute ago' : `${Math.floor(minutes)} minutes ago`
    return { outcome: 'notify', decidedBy: 'live', reason: `You were talking with ${names.first} ${ago}.` }
  }
  if (reading === undefined) return { needsReading: true }
  if (reading === 'failed') {
    const direct = isDm(candidate.channel.kind) || candidate.mentionsMe
    return { outcome: direct ? 'notify' : 'stay', decidedBy: 'timeout', reason: "Juno couldn't read this in time." }
  }
  return byInstruction(settings, reading) ?? byNeeds(candidate, names, reading)
}

/** A chosen instruction decides when the reading is sure enough for its direction. */
function byInstruction(settings: NotificationSettings, reading: Reading): NotificationDecision | undefined {
  const chosen = settings.instructions?.find((item) => item.id === reading.instruction?.id)
  if (chosen === undefined || reading.instruction === undefined) return undefined
  const enough = chosen.direction === 'notify' ? INSTRUCTION_NOTIFY_CONFIDENCE : INSTRUCTION_STAY_CONFIDENCE
  if (reading.instruction.confidence < enough) return undefined
  return {
    outcome: chosen.direction,
    decidedBy: 'instruction',
    reason: `Your instructions: ${chosen.direction === 'notify' ? 'Notify me' : "Don't notify"}: ${chosen.text}`,
    instructionId: chosen.id,
  }
}

/**
 * Whether an option counts towards notifying here: an answer, a follow-up and
 * something serious always; an ask in a DM or group DM, or elsewhere when the
 * owner started the thread, wrote the previous message or is named; a
 * decision only in a thread the owner started.
 */
function counts(option: NeedsYou, candidate: NotificationCandidate): boolean {
  const facts = candidate.facts ?? {}
  switch (option) {
    case 'answer':
    case 'follow_up':
    case 'serious':
      return true
    case 'ask':
      return isDm(candidate.channel.kind) || facts.ownerStartedThread === true || facts.ownerWroteLast === true || candidate.mentionsMeDirectly === true
    case 'decision':
      return facts.ownerStartedThread === true
    default:
      return false
  }
}

/** Notifies when the options that count add up to the threshold. The reason names the likeliest option on the side that won. */
function byNeeds(candidate: NotificationCandidate, names: Names, reading: Reading): NotificationDecision {
  const p = (option: NeedsYou) => reading.probabilities[option] ?? 0
  const counted = needsYouOptions.filter((option) => counts(option, candidate))
  const notify = counted.reduce((sum, option) => sum + p(option), 0) >= NEEDS_YOU_THRESHOLD
  const side = needsYouOptions.filter((option) => counted.includes(option) === notify)
  const named = side.includes(reading.needsYou) ? reading.needsYou : side.reduce((best, option) => (p(option) > p(best) ? option : best))
  const place = isDm(candidate.channel.kind) ? '' : ` in ${names.where}`
  const reasons: Record<NeedsYou, string> = {
    ask: notify ? `${names.first} asks you something.` : `${names.first} asks everyone, not you.`,
    answer: `${names.first} answered your question.`,
    follow_up: `${names.first} is following up, and you haven't replied.`,
    decision: notify ? `A decision is being made${place}.` : `A discussion${place}, with nothing asked of you.`,
    serious: `Something serious${place}, and you're part of it.`,
    greeting: `${names.first} said hello. Nothing asked yet.`,
    fyi: 'An update with nothing asked of you.',
    chatter: "Talk you're not part of.",
  }
  return { outcome: notify ? 'notify' : 'stay', decidedBy: 'reading', reason: reasons[named] }
}
