/**
 * The dispatcher (plan v3 §6.3, §6.5; spec `authorizeDispatch`,
 * `transportSend`, `recordReceipt`, `reject`, `lose`, `reconcile`, and the
 * `progress` drain).
 *
 *   click ─▶ approval ─authorize (consume)─▶ attempt ─executor─▶ receipt: done
 *                                                      ├▶ definite rejection: failed
 *                                                      └▶ no answer: unknown
 *   startup: open authorizations ─▶ unknown ─reconcile─▶ done | unknown (kept)
 *
 * One worker drains approved children in click order, one at a time, so a
 * batch reaches its destination in the card's order. Before each it checks
 * the policy (`authorizeDecision`) on facts read in the same synchronous
 * step as `authorize` commits, so nothing can change in between. A refusal
 * for a reason that can pass (paused, off, not the owner) leaves the
 * approval waiting; any other refusal is written on the approval, and the
 * click never runs.
 *
 * Nothing here retries. One authorization is one attempt, and an attempt
 * Juno cannot confirm stays `unknown` (the card shows "Failed"). A child
 * whose destination does not deduplicate is never authorized twice
 * (`noRepeatAuthorization`). Reconcile looks for positive evidence once per
 * start, and never makes a second attempt.
 */
import { expandChildActions, type ExecutableIdentity } from '@juno/agent-cards'
import { authorizeDecision, type Invalid } from '../policy/policy'
import { authorityOf } from '../grants/grants'
import { crashPoint } from '../runtime/crash'
import { transaction } from '../store/database'
import { authorize, recordAttempt, recordReceipt, settleAuthorization, type JournalPosition } from '../store/ledger'
import type { Store } from '../store/store'
import { cardRow, expiry, memoryGen, payloadOf, settleCardOutcome, type IntentRow } from './cards'
import type { Executor, ExecutorCall } from './executor'

export interface DispatcherOptions {
  readonly store: Store
  readonly executors: () => ReadonlyArray<Executor>
  /** The journal position now (`Turns.position`): an authorization raises the incarnation's authorized position to it. */
  readonly position: () => Promise<JournalPosition>
  /** Something a card shows changed. */
  readonly onChange: () => void
  /** A click's child settled and its card's outcome is recorded: done, failed or unknown. */
  readonly onSettled?: (cardId: string) => void
  readonly onReport?: (error: unknown) => void
}

interface Pending {
  readonly approvalId: string
  readonly opId: string
  readonly cardId: string
  readonly intent: IntentRow
}

export function createDispatcher(options: DispatcherOptions) {
  const { store } = options
  const executor = (tool: string) => options.executors().find((e) => e.tool === tool)
  let closed = false
  let running: Promise<void> | undefined
  let again = false

  const pending = (): ReadonlyArray<Pending> =>
    (store.db
      .prepare(
        `SELECT approvals.id AS approvalId, approvals.op_id AS opId, approvals.card_id AS cardId, approvals.intent_id AS intentId FROM approvals
         WHERE refused IS NULL AND NOT EXISTS (SELECT 1 FROM authorizations WHERE authorizations.approval_id = approvals.id)
         ORDER BY approvals.at, approvals.op_id, approvals.position`,
      )
      .all() as Array<{ approvalId: string; opId: string; cardId: string; intentId: string }>).map((row) => ({
      ...row,
      intent: store.db.prepare('SELECT * FROM intents WHERE id = ?').get(row.intentId) as unknown as IntentRow,
    }))

  /**
   * Spec `valid`, the part in Juno's own records: the intent is still the
   * card's current child, unexpired, and in this memory generation.
   * Synchronous, so it is read in the same step as `authorize`.
   */
  const recordsValid = (item: Pending): 'valid' | Invalid => {
    const card = cardRow(store, item.cardId)!
    const child = currentChild(item)
    if (child === undefined || child.rev !== item.intent.rev) return 'stale'
    if (item.intent.source !== memoryGen(store)) return 'sourceChanged'
    if (expiry(store, card, store.now()) !== undefined) return 'expired'
    return 'valid'
  }

  const currentChild = (item: Pending) => {
    const card = cardRow(store, item.cardId)!
    const payload = payloadOf(store, card)
    return expandChildActions(payload).find((c) => c.id === item.intent.action_id)
  }

  const refuse = (item: Pending, reason: string) => {
    transaction(store.db, () => {
      store.db.prepare('UPDATE approvals SET refused = ? WHERE id = ? AND refused IS NULL').run(reason, item.approvalId)
    })
    settleCard(item.cardId)
    options.onSettled?.(item.cardId)
  }

  const settleCard = (cardId: string) => settleCardOutcome(store, cardId)

  /** One approved child: check, authorize, attempt, run, record. Returns false when the drain must wait (paused, off, not the owner, no account yet). */
  const dispatch = async (item: Pending): Promise<boolean> => {
    const payload = JSON.parse(item.intent.payload) as ExecutableIdentity
    const found = executor(payload.tool)
    if (found === undefined) {
      refuse(item, 'unavailable')
      return true
    }
    // The destination's side of `valid` (account, schema, preconditions) needs I/O, so it is read first.
    const identity = found.check === undefined ? 'valid' : await found.check(payload)
    if (identity === 'wait') return false
    const position = await options.position()
    // From here to `authorize` nothing awaits, so Juno's records cannot change under the decision.
    const records = recordsValid(item)
    const valid = records === 'valid' ? identity : records
    const prior = store.db
      .prepare('SELECT intents.digest FROM authorizations JOIN intents ON intents.id = authorizations.intent_id WHERE intents.action_id = ?')
      .all(item.intent.action_id) as Array<{ digest: string }>
    const done = store.db
      .prepare(
        `SELECT 1 FROM receipts JOIN attempts ON attempts.id = receipts.attempt_id JOIN authorizations ON authorizations.id = attempts.authorization_id
         JOIN intents ON intents.id = authorizations.intent_id WHERE intents.action_id = ?`,
      )
      .get(item.intent.action_id) !== undefined
    const decision = authorizeDecision({
      authority: authorityOf(store),
      intent: { rev: item.intent.rev, digest: item.intent.digest, tier: item.intent.tier, deduped: item.intent.deduped === 1 },
      validity: valid,
      approval: { rev: item.intent.rev, digest: item.intent.digest, used: false, batchOrdered: true },
      grant: false,
      prior: prior.map((row) => row.digest),
      done,
    })
    if (decision._tag === 'refused') {
      if (decision.reason === 'paused' || decision.reason === 'off' || decision.reason === 'notOwner') return false
      refuse(item, decision.reason === 'invalid' ? decision.invalid : decision.reason)
      return true
    }
    const authorized = authorize(store, { intentId: item.intent.id, approvalId: item.approvalId, originOp: item.opId, position })
    if (authorized._tag === 'refused') {
      // The journal rotated under the position: read it again on the next pass.
      if (authorized.reason !== 'rotated') return false
      again = true
      return true
    }
    options.onChange()
    const attemptId = recordAttempt(store, authorized.id)
    // Pause cancelled it before the handoff: nothing was sent.
    if (attemptId === undefined) return true
    const call: ExecutorCall = {
      actionId: item.intent.action_id, authorizationId: authorized.id, attemptId, digest: item.intent.digest,
      payload, cardId: item.cardId, opId: item.opId,
    }
    let result: Awaited<ReturnType<Executor['run']>>
    try {
      result = await found.run(call)
    } catch (error) {
      options.onReport?.(error)
      result = { _tag: 'unknown', detail: 'The action failed in Juno.' }
    }
    if (result.output !== undefined) {
      store.db.prepare('INSERT OR IGNORE INTO action_outputs (attempt_id, model, line) VALUES (?, ?, ?)').run(attemptId, result.output.model ?? null, result.output.line ?? null)
    }
    switch (result._tag) {
      case 'done':
        crashPoint('attempt.beforeReceipt')
        recordReceipt(store, attemptId, result.receipt)
        break
      case 'failed':
        settleAuthorization(store, authorized.id, 'failed', result.detail)
        break
      case 'unknown':
        settleAuthorization(store, authorized.id, 'unknown', result.detail)
        break
    }
    settleCard(item.cardId)
    options.onChange()
    options.onSettled?.(item.cardId)
    return true
  }

  /** Dispatches in click order until nothing is pending, or the first child must wait. A kick meanwhile looks again. */
  const drain = async () => {
    for (;;) {
      again = false
      for (const item of pending()) {
        if (closed) return
        if (!(await dispatch(item))) break
      }
      if (!again || closed) return
    }
  }

  /** Runs the drain, or asks the running one to look again. */
  const kick = (): Promise<void> => {
    if (closed) return Promise.resolve()
    if (running !== undefined) {
      again = true
      return running
    }
    running = drain()
      .catch((error: unknown) => options.onReport?.(error))
      .finally(() => {
        running = undefined
      })
    return running
  }

  /**
   * Startup (§6.5): authorizations recovery classified `unknown` look for
   * positive evidence, once, in the background. A miss keeps them unknown.
   */
  const reconcile = async () => {
    const unknown = store.db
      .prepare(
        `SELECT authorizations.id AS authorizationId, attempts.id AS attemptId, intents.action_id AS actionId, intents.digest, intents.payload, intents.card_id AS cardId, authorizations.origin_op AS opId
         FROM authorizations JOIN attempts ON attempts.authorization_id = authorizations.id JOIN intents ON intents.id = authorizations.intent_id
         WHERE authorizations.outcome = 'unknown'`,
      )
      .all() as Array<{ authorizationId: string; attemptId: string; actionId: string; digest: string; payload: string; cardId: string; opId: string | null }>
    for (const row of unknown) {
      if (closed) return
      const payload = JSON.parse(row.payload) as ExecutableIdentity
      const found = executor(payload.tool)
      if (found?.reconcile === undefined) continue
      try {
        const result = await found.reconcile({ ...row, payload, opId: row.opId ?? '' })
        if (result._tag !== 'found') continue
        recordReceipt(store, row.attemptId, result.receipt)
        settleCard(row.cardId)
        options.onChange()
      } catch (error) {
        options.onReport?.(error)
      }
    }
  }

  return {
    kick,
    reconcile,
    /** Resolves when nothing is being dispatched. */
    idle: async () => {
      for (let current = running; current !== undefined; current = running) await current
    },
    close: async () => {
      closed = true
      await running
    },
  }
}
