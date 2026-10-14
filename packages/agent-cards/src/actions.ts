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

/**
 * What a row shows. A receipt for any attempt means sent. An attempt Juno cannot confirm shows as
 * failed, like a rejection; the record keeps it as `unknown` and Activity shows the difference.
 */
export function childOutcome(evidence: ChildEvidence): 'pending' | 'sending' | 'sent' | 'failed' {
  const states = evidence.attempts.map((a) => a.outcome)
  if (states.includes('done')) return 'sent'
  if (states.some((s) => s === 'consumed' || s === 'submitted' || s === 'cancel-requested')) return 'sending'
  return states.length === 0 ? 'pending' : 'failed'
}

/** A batch click binds order, child ids, revisions and exact executable digests. */
export const batchIdentity = (payload: CardPayload) => expandChildActions(payload).map((child) => ({
  id: child.id, rev: child.rev, digest: actionDigest(child.payload),
}))
