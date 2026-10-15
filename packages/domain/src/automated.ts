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

/** Who sent a message: an app or bot, the user, or another person. */
export type Sender = 'app' | 'you' | 'person'

/** What the rules read about a conversation. */
export interface ConversationSample {
  readonly kind: 'public' | 'private' | 'im' | 'mpim'
  /** The channel name; '' for a DM. */
  readonly name: string
  /** A DM whose other side is a bot or an app. */
  readonly partnerIsApp?: boolean
  /** The senders of its latest messages, at most `AUTOMATED_SAMPLE`. */
  readonly senders: ReadonlyArray<Sender>
}

/**
 * - `automated`: move it to the view.
 * - `ambiguous`: ask Juno, then the user.
 * - `people`: leave it in All.
 * - `unknown`: too few messages to tell; look again when it has more.
 */
export type AutomatedVerdict = 'automated' | 'ambiguous' | 'people' | 'unknown'

/** Messages the rules read per conversation. */
export const AUTOMATED_SAMPLE = 30
/** Fewer messages than this say nothing. */
export const AUTOMATED_MIN_MESSAGES = 4
/** Share of messages from apps that makes a channel automated on its own. */
export const APP_SHARE_AUTOMATED = 0.8
/** With an integration-style name, this share is enough. */
export const APP_SHARE_NAMED = 0.5
/** Below this share, and with no integration-style name, a channel is people talking. */
export const APP_SHARE_AMBIGUOUS = 0.3

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
 * group DM is people. A channel is automated when most of its latest
 * messages come from apps (or half do and its name says so) and the user
 * did not write there; ambiguous when apps write a fair share, or it has
 * an integration name and some app messages, or it would be automated but
 * the user writes there too.
 */
export function classifyConversation(sample: ConversationSample): AutomatedVerdict {
  if (sample.kind === 'im') return sample.partnerIsApp === true ? 'automated' : 'people'
  if (sample.kind === 'mpim') return 'people'
  const total = sample.senders.length
  if (total < AUTOMATED_MIN_MESSAGES) return 'unknown'
  const apps = sample.senders.filter((sender) => sender === 'app').length
  const share = apps / total
  const named = integrationName(sample.name)
  const strong = share >= APP_SHARE_AUTOMATED || (named && share >= APP_SHARE_NAMED)
  if (strong) return sample.senders.includes('you') ? 'ambiguous' : 'automated'
  if (share >= APP_SHARE_AMBIGUOUS || (named && apps > 0)) return 'ambiguous'
  return 'people'
}

/** Juno's answer, the probability that a conversation is automated: at or above, move it. */
export const JUNO_MOVE_MIN = 0.85
/** At or below, leave it in All without asking. */
export const JUNO_KEEP_MAX = 0.2

/** What Juno's probability decides for an ambiguous conversation. */
export function junoVerdict(probability: number): 'automated' | 'ambiguous' | 'people' {
  if (probability >= JUNO_MOVE_MIN) return 'automated'
  if (probability <= JUNO_KEEP_MAX) return 'people'
  return 'ambiguous'
}
