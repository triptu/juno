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
/**
 * Below this share a channel is people talking, and is not asked about. An
 * app that posts a minority of the messages (meeting notes, a standup bot,
 * links unfurled by an integration) does not make people's channel unclear.
 */
export const APP_SHARE_AMBIGUOUS = 0.5
/** With an integration-style name, this share is enough to ask. */
export const APP_SHARE_NAMED_AMBIGUOUS = 0.3

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
 * group DM is people. A channel the user wrote in is people: they talk
 * there. Otherwise a channel is automated when most of its latest messages
 * come from apps (or half do and its name says so), and ambiguous when
 * apps write at least half (or, with an integration name, a third).
 */
export function classifyConversation(sample: ConversationSample): AutomatedVerdict {
  if (sample.kind === 'im') return sample.partnerIsApp === true ? 'automated' : 'people'
  if (sample.kind === 'mpim') return 'people'
  const total = sample.senders.length
  if (total < AUTOMATED_MIN_MESSAGES) return 'unknown'
  if (sample.senders.includes('you')) return 'people'
  const apps = sample.senders.filter((sender) => sender === 'app').length
  const share = apps / total
  const named = integrationName(sample.name)
  if (share >= APP_SHARE_AUTOMATED || (named && share >= APP_SHARE_NAMED)) return 'automated'
  if (share >= APP_SHARE_AMBIGUOUS || (named && share >= APP_SHARE_NAMED_AMBIGUOUS)) return 'ambiguous'
  return 'people'
}

/** Juno's answer, the probability that a conversation is automated: at or above, move it. */
export const JUNO_MOVE_MIN = 0.85
/** At or below, leave it in All without asking. Leaving a channel in All costs less than hiding one people talk in. */
export const JUNO_KEEP_MAX = 0.4

/** What Juno's probability decides for an ambiguous conversation. */
export function junoVerdict(probability: number): 'automated' | 'ambiguous' | 'people' {
  if (probability >= JUNO_MOVE_MIN) return 'automated'
  if (probability <= JUNO_KEEP_MAX) return 'people'
  return 'ambiguous'
}

/**
 * Home's one line on why it asks about a channel: Juno's reason when Juno
 * gave one, else the count the rules read. Undefined when neither is known.
 */
export function automatedReason(why: { readonly apps?: number | null; readonly of?: number | null; readonly juno?: string | null }): string | undefined {
  const juno = why.juno?.trim().replace(/[.\s]+$/, '') ?? ''
  if (juno !== '') return juno.charAt(0).toUpperCase() + juno.slice(1)
  if (why.apps == null || why.of == null || why.of === 0) return undefined
  return `${why.apps === 1 ? 'An app' : 'Apps'} wrote ${why.apps} of the last ${why.of} messages`
}
