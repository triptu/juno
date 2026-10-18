/**
 * Why a Send card's row failed, in the card's words
 * (`chatCopy.card.sendMessage.failure`). The facts are what the ledger kept:
 * the authorization's outcome, the executor's detail (a Slack code such as
 * `not_in_channel`, or the host's refusal as `reason: message`), and the
 * dispatcher's refusal when the click never ran. Activity keeps the raw
 * detail behind Copy details.
 */
import { chatCopy } from '@juno/agent-contract'
import type { Store } from '../store/store'
import type { Outcome } from '../store/ledger'

const SLACK: Record<string, keyof typeof chatCopy.card.sendMessage.failure> = {
  not_in_channel: 'notInChannel',
  channel_not_found: 'notFound',
  is_archived: 'archived',
  msg_too_long: 'tooLong',
  discarded: 'discarded',
  cancelled: 'cancelled',
  signedOut: 'signedOut',
  NotSignedIn: 'signedOut',
  rateLimited: 'rateLimited',
  RateLimited: 'rateLimited',
}

/** The host refused before it recorded anything (`AgentHostError` reasons). */
const HOST: Record<string, keyof typeof chatCopy.card.sendMessage.failure> = {
  rejected: 'approval',
  unsupported: 'off',
  stale: 'otherAccount',
  signedOut: 'signedOut',
  offline: 'offline',
  rateLimited: 'rateLimited',
  notFound: 'notFound',
}

export function failureReason(outcome: Outcome | undefined, detail: string | null, refused: string | null): string | undefined {
  const copy = chatCopy.card.sendMessage.failure
  if (outcome === 'unknown') return copy.unconfirmed
  if (outcome === undefined) return refused === null ? undefined : refused === 'accountChanged' ? copy.otherAccount : copy.changed
  if (detail === null) return undefined
  const host = /^(\w+): /.exec(detail)?.[1]
  if (host !== undefined && HOST[host] !== undefined) return copy[HOST[host]] as string
  const known = SLACK[detail]
  if (known !== undefined) return copy[known] as string
  if (detail.startsWith('restricted_action') || detail.startsWith('cant_')) return copy.restricted
  return /^[a-z_]+$/.test(detail) ? copy.slack(detail) : undefined
}

/** The reason for one row: its latest authorization, or the refusal of its click. */
export function sendFailure(store: Store, cardId: string, actionId: string): string | undefined {
  const auth = store.db
    .prepare(
      `SELECT authorizations.outcome, action_results.detail FROM authorizations JOIN intents ON intents.id = authorizations.intent_id
       LEFT JOIN action_results ON action_results.authorization_id = authorizations.id
       WHERE intents.card_id = ? AND intents.action_id = ? ORDER BY consumed_at DESC LIMIT 1`,
    )
    .get(cardId, actionId) as { outcome: Outcome; detail: string | null } | undefined
  if (auth !== undefined) return failureReason(auth.outcome, auth.detail, null)
  const refusal = store.db
    .prepare('SELECT approvals.refused FROM approvals JOIN intents ON intents.id = approvals.intent_id WHERE approvals.card_id = ? AND intents.action_id = ? AND approvals.refused IS NOT NULL')
    .get(cardId, actionId) as { refused: string } | undefined
  return failureReason(undefined, null, refusal?.refused ?? null)
}
