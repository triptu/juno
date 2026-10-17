/**
 * The built-in Automated view (SPEC section 5, "Automated"): which
 * conversations are bots and alerts, decided in code first. Clear cases are
 * moved into the view; ambiguous ones go to Juno when AI assist is on, and
 * what stays ambiguous is asked about on Home.
 */
import type { ViewIcon } from './views'

/** The view's fixed id, so a rename, an icon change or a delete with Undo keeps it the built-in one. */
export const AUTOMATED_VIEW_ID = 'automated'

/** The view as Juno first makes it. */
export const AUTOMATED_VIEW = { name: 'Automated', icon: 'robot' satisfies ViewIcon, keepOutOfAll: true } as const

/** Who sent a message: an app or bot, the user, or another person. A person's message that tags or asks a bot is the person's. */
export type Sender = 'app' | 'you' | 'person'

/** One of a conversation's latest messages, as the rules read it. */
export interface SampledMessage {
  readonly sender: Sender
  /** A reply in a thread. Replies say nothing about who starts conversations, so the rules skip them. */
  readonly reply?: boolean
}

/** What the rules read about a conversation. */
export interface ConversationSample {
  readonly kind: 'public' | 'private' | 'im' | 'mpim'
  /** The channel name; '' for a DM. */
  readonly name: string
  /** A DM whose other side is a bot or an app. */
  readonly partnerIsApp?: boolean
  /** Its latest messages, newest first. Only the first `AUTOMATED_SAMPLE` top-level ones count. */
  readonly messages: ReadonlyArray<SampledMessage>
}

/**
 * - `automated`: move it to the view.
 * - `ambiguous`: ask Juno, then the user.
 * - `people`: leave it in All.
 * - `unknown`: too few messages to tell; look again when it has more.
 */
export type AutomatedVerdict = 'automated' | 'ambiguous' | 'people' | 'unknown'

/** Top-level messages the rules read per conversation. */
export const AUTOMATED_SAMPLE = 30
/** Fewer top-level messages than this say nothing. */
export const AUTOMATED_MIN_MESSAGES = 4
/**
 * People started at most this share of the latest top-level messages: apps
 * clearly start the conversations, and the channel moves on its own. A move
 * happens without asking, so it needs high confidence (owner, 10-17).
 */
export const PEOPLE_SHARE_MOVE = 0.2
/** With an integration-style name, this share of people is still a move. */
export const PEOPLE_SHARE_MOVE_NAMED = 0.3
/**
 * People started at least this share: a people channel, not asked about,
 * however much apps reply in its threads or post now and then (Cursor,
 * Devin, CI, a meeting-notes app).
 */
export const PEOPLE_SHARE_PEOPLE = 0.5
/** With an integration-style name, people must start this share to leave it unasked. */
export const PEOPLE_SHARE_PEOPLE_NAMED = 0.7

/** Who wrote a conversation's latest top-level messages: the numbers the rules decide on and the reasons quote. */
export interface PostingCounts {
  /** Top-level messages from apps and bots. */
  readonly apps: number
  /** Top-level messages from people, the user included. */
  readonly people: number
  /** Of `people`, the user's. */
  readonly you: number
  /** Top-level messages read: `apps + people`. */
  readonly of: number
}

/** Counts the first `AUTOMATED_SAMPLE` top-level messages by who wrote them. Thread replies are skipped. */
export function postingCounts(messages: ReadonlyArray<SampledMessage>): PostingCounts {
  let apps = 0
  let people = 0
  let you = 0
  for (const message of messages) {
    if (message.reply === true) continue
    if (apps + people >= AUTOMATED_SAMPLE) break
    if (message.sender === 'app') apps += 1
    else {
      people += 1
      if (message.sender === 'you') you += 1
    }
  }
  return { apps, people, you, of: apps + people }
}

/** Words that name an integration channel: alerts-prod, deploy-notifications, ci, github-feed. */
const INTEGRATION_WORDS = new Set([
  'alert',
  'alerts',
  'alarms',
  'notifications',
  'notification',
  'notifs',
  'deploy',
  'deploys',
  'deployments',
  'ci',
  'cd',
  'builds',
  'bot',
  'bots',
  'monitoring',
  'logs',
  'feed',
  'github',
  'sentry',
  'pagerduty',
  'datadog',
  'grafana',
  'jira',
  'webhooks',
])

/** A name made of words like alerts, deploys, ci or notifications, split on - and _. */
export function integrationName(name: string): boolean {
  return name
    .toLowerCase()
    .split(/[-_.]+/)
    .some((word) => INTEGRATION_WORDS.has(word))
}

/**
 * The rules, in code, with no model call. A DM with an app is automated; a
 * group DM is people. A channel is judged by who starts its conversations:
 * its latest top-level messages, never the replies in its threads. One
 * where the user started a conversation is people. Otherwise it is
 * automated when people started at most a fifth of them (three in ten with
 * an integration name), people when they started at least half (seven in
 * ten with an integration name), and ambiguous in between.
 */
export function classifyConversation(sample: ConversationSample): AutomatedVerdict {
  if (sample.kind === 'im') return sample.partnerIsApp === true ? 'automated' : 'people'
  if (sample.kind === 'mpim') return 'people'
  return classifyCounts(sample.name, postingCounts(sample.messages))
}

/** The channel rule on counts already taken (`postingCounts`), so a caller can quote the same numbers. */
export function classifyCounts(name: string, counts: PostingCounts): AutomatedVerdict {
  if (counts.of < AUTOMATED_MIN_MESSAGES) return 'unknown'
  if (counts.you > 0) return 'people'
  const share = counts.people / counts.of
  const named = integrationName(name)
  if (share <= PEOPLE_SHARE_MOVE || (named && share <= PEOPLE_SHARE_MOVE_NAMED)) return 'automated'
  if (share >= (named ? PEOPLE_SHARE_PEOPLE_NAMED : PEOPLE_SHARE_PEOPLE)) return 'people'
  return 'ambiguous'
}

/** Juno's answer, the probability that a conversation is automated: at or above, move it. */
export const JUNO_MOVE_MIN = 0.9
/** At or below, leave it in All without asking. Leaving a channel in All costs less than hiding one people talk in. */
export const JUNO_KEEP_MAX = 0.4

/** What Juno's probability decides for an ambiguous conversation. */
export function junoVerdict(probability: number): 'automated' | 'ambiguous' | 'people' {
  if (probability >= JUNO_MOVE_MIN) return 'automated'
  if (probability <= JUNO_KEEP_MAX) return 'people'
  return 'ambiguous'
}

/**
 * Why Juno moved a channel or asks about one, in one line: Juno's reason
 * when Juno gave one, else the count the rules read ("Apps wrote 24 of the
 * last 30 top-level messages"). Undefined when neither is known.
 */
export function automatedReason(why: { readonly apps?: number | null; readonly of?: number | null; readonly juno?: string | null }): string | undefined {
  const juno = why.juno?.trim().replace(/[.\s]+$/, '') ?? ''
  if (juno !== '') return juno.charAt(0).toUpperCase() + juno.slice(1)
  if (why.apps == null || why.of == null || why.of === 0) return undefined
  return `${why.apps === 1 ? 'An app' : 'Apps'} wrote ${why.apps} of the last ${why.of} top-level messages`
}

/**
 * Why Juno took a channel out of Automated, from the counts that decided it:
 * the line ("Moved back: people start most conversations here") and the
 * numbers ("People wrote 18 of the last 30 top-level messages").
 */
export function movedBackReason(counts: Pick<PostingCounts, 'people' | 'you' | 'of'>): { readonly line: string; readonly detail: string | undefined } {
  // A channel the user started a conversation in is people, whoever else writes there.
  const mine = counts.you > 0
  const line = mine ? 'Moved back: you start conversations here' : 'Moved back: people start most conversations here'
  if (counts.of === 0) return { line, detail: undefined }
  const who = mine ? 'You' : counts.people === 1 ? 'A person' : 'People'
  return { line, detail: `${who} wrote ${mine ? counts.you : counts.people} of the last ${counts.of} top-level messages` }
}
