/**
 * The actions under a run on the Activity page (plan v3 §13.3; SPEC 13.9):
 * each action the run proposed with the decision made about it and its
 * outcome, and each job the run started with no click. An open card has no
 * decision yet and is not listed. A failure is in plain words; what the
 * destination said is behind "Copy details".
 */
import type { ActivityAction } from '@juno/agent-contract'
import type { CardPayload } from '@juno/agent-cards'
import { cardRow, expiry, payloadOf, type CardRow } from './cards'
import type { Store } from '../store/store'
import type { Outcome } from '../store/ledger'

const FAILED = 'It did not go through.'
const UNCONFIRMED = 'Juno could not confirm it went through.'

function labelOf(payload: CardPayload): string {
  switch (payload._tag) {
    case 'sendMessage':
      return payload.messages.length === 1 ? `Message to ${payload.messages[0]!.target.name}` : `${payload.messages.length} messages`
    case 'resolve':
      return payload.topics.length === 1 ? `Resolve ${payload.topics[0]!.title}` : `Resolve ${payload.topics.length} topics`
    case 'proposedTask':
      return `Start ${payload.title}`
    case 'question':
      return payload.prompt
    case 'proposedSchedule':
    case 'schedule':
      return `Schedule ${payload.what}`
    case 'connect':
      return `Connect ${payload.server}`
    case 'change':
      return `Change ${payload.target} in ${payload.server}`
    case 'remove':
      return payload.messages.length === 1 ? 'Remove a message' : `Remove ${payload.messages.length} messages`
    case 'budget':
      return 'Allow $1 more today'
    case 'provider':
      return 'Choose a model provider'
    case 'topics':
    case 'task':
      return ''
  }
}

const tierOf = (payload: CardPayload): 1 | 2 | 3 =>
  'action' in payload ? payload.action.tier : 3

type SendChild = Extract<CardPayload, { _tag: 'sendMessage' }>['messages'][number]

function cardAction(store: Store, card: CardRow, payload: CardPayload, child?: SendChild): ActivityAction | undefined {
  const approvals = store.db.prepare('SELECT refused FROM approvals WHERE card_id = ?').all(card.id) as Array<{ refused: string | null }>
  const base = { id: child?.actionId ?? card.id, tier: tierOf(payload), label: child === undefined ? labelOf(payload) : `Message to ${child.target.name}` }
  if (card.dismissed_at !== null) return { ...base, decision: 'dismissed', outcome: 'none' }
  const refused = approvals.find((a) => a.refused !== null)?.refused
  const auths = store.db
    .prepare(
      `SELECT authorizations.outcome, action_results.detail FROM authorizations JOIN intents ON intents.id = authorizations.intent_id
       LEFT JOIN action_results ON action_results.authorization_id = authorizations.id WHERE intents.card_id = ? AND (? IS NULL OR intents.action_id = ?) ORDER BY consumed_at`,
    )
    .all(card.id, child?.actionId ?? null, child?.actionId ?? null) as Array<{ outcome: Outcome; detail: string | null }>
  if (approvals.length === 0 && auths.length === 0) return expiry(store, card, store.now()) === undefined ? undefined : { ...base, decision: 'expired', outcome: 'none' }
  const decision = approvals.length === 0 ? 'noClick' : 'approved'
  if (auths.length === 0 && refused != null) {
    const expired = refused === 'expired' || refused === 'stale' || refused === 'sourceChanged'
    return expired ? { ...base, decision: 'expired', outcome: 'none' } : { ...base, decision: 'refused', outcome: 'none', failure: { text: FAILED, details: refused } }
  }
  const outcomes = auths.map((a) => a.outcome)
  const details = auths.flatMap((a) => (a.detail === null ? [] : [a.detail])).join('\n')
  if (outcomes.length === 0 || outcomes.some((o) => o === 'consumed' || o === 'sent' || o === 'cancel-requested')) return { ...base, decision, outcome: 'pending' }
  if (outcomes.every((o) => o === 'done') && refused == null) return { ...base, decision, outcome: 'done' }
  if (outcomes.includes('unknown')) return { ...base, decision, outcome: 'unknown', failure: { text: UNCONFIRMED, details } }
  return { ...base, decision, outcome: 'failed', failure: { text: FAILED, details: details || (refused ?? '') } }
}

/** The run's actions, in the order they happened. */
export function activityActions(store: Store, runId: string): ReadonlyArray<ActivityAction> {
  const cards = (store.db.prepare("SELECT id FROM cards WHERE run_id = ? AND kind NOT IN ('topics', 'task') ORDER BY created_at, id").all(runId) as Array<{ id: string }>)
    .flatMap(({ id }) => {
      const card = cardRow(store, id)!
      const payload = payloadOf(store, card)
      const actions = payload._tag === 'sendMessage'
        ? payload.messages.map((child) => cardAction(store, card, payload, child))
        : [cardAction(store, card, payload)]
      return actions.flatMap((action) => action === undefined ? [] : [{ at: card.created_at, action }])
    })
  // A job a clean owner run started with no click.
  const jobs = (store.db
    .prepare(
      `SELECT jobs.id, jobs.title, jobs.phase, jobs.created_at AS at FROM jobs JOIN grants ON grants.op_class = 'job' AND grants.target = jobs.id
       WHERE jobs.run_id = ? AND grants.authority = 'cleanRun'`,
    )
    .all(runId) as Array<{ id: string; title: string; phase: string; at: number }>).map((job) => ({
    at: job.at,
    action: {
      id: job.id, tier: 2 as const, label: `Start ${job.title}`, decision: 'noClick' as const,
      outcome: job.phase === 'done' ? ('done' as const) : job.phase === 'failed' ? ('failed' as const) : job.phase === 'stopped' ? ('none' as const) : job.phase === 'unknown' ? ('unknown' as const) : ('pending' as const),
    },
  }))
  return [...cards, ...jobs].toSorted((a, b) => a.at - b.at).map((row) => row.action)
}
