/**
 * A Send card follows the host's outbox (`host.outbox.states`). The host
 * says what each recent send's outbox row is now; this keeps the latest
 * word per attempt in `send_states`, and the card's rows read it
 * (`sendRowState`) rather than the outcome the dispatch first got. So a
 * refused send the owner retries from the topic goes from "Failed" back to
 * "Sending", then to "Sent · Open".
 *
 * A send the outbox posted after its authorization settled failed or
 * unknown gets its receipt, so the ledger, Activity and the model's card
 * outcome say it was sent. Nothing here sends: the agent never retries.
 */
import type { HostSendState } from '@juno/agent-contract'
import type { Store } from '../store/store'
import { recordReceipt, type Outcome } from '../store/ledger'

type SendState = typeof HostSendState.Type

/** Takes the host's states; `settled` records a card's outcome again. Returns whether a card may show something new. */
export function followOutbox(store: Store, states: ReadonlyArray<SendState>, settled: (cardId: string) => void): boolean {
  let changed = false
  for (const state of states) {
    const attempt = store.db
      .prepare(
        `SELECT authorizations.outcome, intents.card_id AS cardId FROM attempts JOIN authorizations ON authorizations.id = attempts.authorization_id
         JOIN intents ON intents.id = authorizations.intent_id WHERE attempts.id = ?`,
      )
      .get(state.attemptId) as { outcome: Outcome; cardId: string } | undefined
    // An attempt this agent never made, such as one from before a restore.
    if (attempt === undefined) continue
    const reason = state.reason ?? null
    const prior = store.db.prepare('SELECT state, reason FROM send_states WHERE attempt_id = ?').get(state.attemptId) as { state: string; reason: string | null } | undefined
    if (prior?.state !== state.state || prior.reason !== reason) {
      store.db
        .prepare('INSERT INTO send_states (attempt_id, state, reason, at) VALUES (?, ?, ?, ?) ON CONFLICT (attempt_id) DO UPDATE SET state = excluded.state, reason = excluded.reason, at = excluded.at')
        .run(state.attemptId, state.state, reason, store.now())
      changed = true
    }
    // A dispatch still in flight records its own receipt.
    if (state.state === 'done' && state.receipt !== undefined && (attempt.outcome === 'failed' || attempt.outcome === 'unknown')) {
      recordReceipt(store, state.attemptId, state.receipt)
      settled(attempt.cardId)
      changed = true
    }
  }
  return changed
}

/** What the outbox says now of a Send card row's latest attempt, if the host has said. */
export function sendRowState(store: Store, cardId: string, actionId: string): { readonly state: SendState['state']; readonly reason: string | null } | undefined {
  return store.db
    .prepare(
      `SELECT send_states.state, send_states.reason FROM send_states JOIN attempts ON attempts.id = send_states.attempt_id
       JOIN authorizations ON authorizations.id = attempts.authorization_id JOIN intents ON intents.id = authorizations.intent_id
       WHERE intents.card_id = ? AND intents.action_id = ? ORDER BY authorizations.consumed_at DESC LIMIT 1`,
    )
    .get(cardId, actionId) as { state: SendState['state']; reason: string | null } | undefined
}
