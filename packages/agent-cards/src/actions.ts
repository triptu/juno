import { Schema } from 'effect'
import { ActionId, AttemptId, ChildAction, DestinationId, Digest, Revision, actionDigest } from './identity'
import type { CardPayload } from './payload'

/** Caller-minted UUIDv7 ids survive expansion, restart and retry. Never mint on expansion. */
export function expandChildActions(payload: CardPayload): ReadonlyArray<ChildAction> {
  if (payload._tag === 'sendMessage') return payload.messages.map((message) => ({
    id: message.actionId,
    rev: message.rev,
    tier: 3,
    deduped: false,
    source: message.source,
    payload: {
      connection_id: message.connectionId,
      account_id: message.accountId,
      destination_ids: [DestinationId.make(message.target.channelId)],
      tool: 'slack.send',
      schema_hash: message.schemaHash,
      args: {
        channel_id: message.target.channelId,
        text: message.text,
        client_msg_id: message.actionId,
        ...(message.threadTs === undefined ? {} : { thread_ts: message.threadTs }),
      },
      preconditions: message.preconditions,
      ops: [],
    },
  }))
  return 'action' in payload ? [payload.action] : []
}

export const AttemptOutcome = Schema.Literals(['consumed', 'submitted', 'cancel-requested', 'cancelled', 'failed', 'unknown', 'done'])
export type AttemptOutcome = typeof AttemptOutcome.Type
export const AttemptEvidence = Schema.Struct({ id: AttemptId, outcome: AttemptOutcome })
export const ChildEvidence = Schema.Struct({ id: ActionId, rev: Revision, digest: Digest, attempts: Schema.Array(AttemptEvidence) })
export type ChildEvidence = typeof ChildEvidence.Type

/** Negative lookups cannot turn uncertainty into failure. Receipts survive cancellation. */
export function transitionAttempt(state: AttemptOutcome, event: 'submit' | 'receipt' | 'reject' | 'lost' | 'negative' | 'cancel' | 'cancelled'): AttemptOutcome {
  if (state === 'done' || event === 'receipt') return 'done'
  if (event === 'negative') return state
  if (state === 'cancelled' || state === 'failed') return state
  switch (event) {
    case 'submit': return state === 'consumed' ? 'submitted' : state
    case 'reject': return 'failed'
    case 'lost': return 'unknown'
    case 'cancel': return state === 'consumed' || state === 'cancel-requested' ? 'cancel-requested' : 'unknown'
    case 'cancelled': return state === 'consumed' || state === 'cancel-requested' ? 'cancelled' : 'unknown'
  }
}

/** A receipt for an older attempt does not settle an unrelated newer attempt. */
export function childOutcome(evidence: ChildEvidence): 'pending' | 'sending' | 'sent' | 'notSent' | 'unknown' {
  const states = evidence.attempts.map((a) => a.outcome)
  if (states.includes('done')) return 'sent'
  if (states.some((s) => s === 'consumed' || s === 'submitted' || s === 'cancel-requested')) return 'sending'
  if (states.includes('unknown')) return 'unknown'
  return states.length === 0 ? 'pending' : 'notSent'
}

/** Only unresolved children are offered again. This does not authorize transport. */
export function retryChildren(payload: CardPayload, evidence: ReadonlyArray<ChildEvidence>) {
  return expandChildActions(payload).filter((child) => {
    const entry = evidence.find((e) => e.id === child.id)
    return !entry?.attempts.some((a) => a.outcome === 'done')
  }).map((child) => ({
    ...child,
    digest: actionDigest(child.payload),
    // Quint retryRequiresAuthority covers every repeat, including definite rejection.
    requiresDuplicateWarning: !child.deduped && evidence.some((e) => e.id === child.id && e.attempts.length > 0),
  }))
}

/** A batch click binds order, child ids, revisions and exact executable digests. */
export const batchIdentity = (payload: CardPayload) => expandChildActions(payload).map((child) => ({
  id: child.id, rev: child.rev, digest: actionDigest(child.payload),
}))
