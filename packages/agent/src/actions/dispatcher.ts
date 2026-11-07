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
 * A kick runs each card's approved children in click order, one at a time,
 * so a batch reaches its destination in the card's order; cards run beside
 * each other, so a click that waits (a connection not ready, a sign-in in
 * progress) holds no other card, and a kick that lands while a card's chain
 * runs makes that chain look once more before it waits. Before each child it checks the
 * policy (`authorizeDecision`) on facts read in the same synchronous step as
 * `authorize` commits, so nothing can change in between. A refusal for a
 * reason that can pass (paused, off, not the owner) leaves the approval
 * waiting; any other refusal is written on the approval, and the click never
 * runs. Juno's own records (expiry, a redaction, an edit) are checked before
 * the destination is asked, so a waiting click still expires.
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
import type { Executor, ExecutorCall, ExecutorOutput } from './executor'

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

/**
 * What came back, kept with the outcome it belongs to and never before it: an attempt Juno lost
 * after the server answered reads Failed with nothing from that answer.
 */
function keepOutput(store: Store, attemptId: string, output: ExecutorOutput | undefined): void {
  if (output === undefined) return
  store.db.prepare('INSERT OR IGNORE INTO action_outputs (attempt_id, model, line, shown) VALUES (?, ?, ?, ?)').run(attemptId, output.model ?? null, output.line ?? null, output.shown ?? null)
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
  /** Resolves when every card's chain ended. */
  let running: Promise<void> | undefined
  let ended: (() => void) | undefined
  /** The chain running each card's children now. */
  const chains = new Map<string, Promise<void>>()
  /** Cards a kick reached while their chain ran: the chain looks once more before it waits. */
  const dirty = new Set<string>()

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

  /**
   * One approved child: check, authorize, attempt, run, record. `wait` when the
   * card must wait (no account or connection yet, paused, off, not the owner),
   * `rotated` when the journal moved under the position and the child goes again.
   */
  const dispatch = async (item: Pending): Promise<'done' | 'wait' | 'rotated'> => {
    const payload = JSON.parse(item.intent.payload) as ExecutableIdentity
    const found = executor(payload.tool)
    if (found === undefined) {
      refuse(item, 'unavailable')
      return 'done'
    }
    // Juno's own records first, so a click that waits on its destination still expires.
    const early = recordsValid(item)
    if (early !== 'valid') {
      refuse(item, early)
      return 'done'
    }
    // The destination's side of `valid` (account, schema, preconditions) needs I/O, so it is read before the step below.
    const identity = found.check === undefined ? 'valid' : await found.check(payload)
    if (identity === 'wait') return 'wait'
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
      if (decision.reason === 'paused' || decision.reason === 'off' || decision.reason === 'notOwner') return 'wait'
      refuse(item, decision.reason === 'invalid' ? decision.invalid : decision.reason)
      return 'done'
    }
    const authorized = authorize(store, { intentId: item.intent.id, approvalId: item.approvalId, originOp: item.opId, position })
    // The journal rotated under the position: read it again and go once more.
    if (authorized._tag === 'refused') return authorized.reason === 'rotated' ? 'rotated' : 'wait'
    options.onChange()
    const attemptId = recordAttempt(store, authorized.id)
    // Pause cancelled it before the handoff: nothing was sent.
    if (attemptId === undefined) return 'done'
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
    switch (result._tag) {
      case 'done':
        crashPoint('attempt.beforeReceipt')
        keepOutput(store, attemptId, result.output)
        recordReceipt(store, attemptId, result.receipt)
        break
      case 'failed':
      case 'unknown':
        keepOutput(store, attemptId, result.output)
        settleAuthorization(store, authorized.id, result._tag, result.detail)
        break
    }
    settleCard(item.cardId)
    options.onChange()
    options.onSettled?.(item.cardId)
    return 'done'
  }

  /**
   * One card's approved children in click order, read again after each; the
   * card waits with the first child that must. A kick that landed while the
   * chain ran (a connection became ready as its check was in flight) makes
   * it read once more, so the change the kick announced is not lost, and a
   * card that waits for good is not looked at again until the next kick.
   */
  const runCard = async (cardId: string) => {
    for (;;) {
      if (closed) return
      dirty.delete(cardId)
      const items = pending().filter((item) => item.cardId === cardId)
      if (items.length === 0) return
      let result: Awaited<ReturnType<typeof dispatch>> = 'done'
      for (const item of items) {
        do {
          if (closed) return
          result = await dispatch(item)
        } while (result === 'rotated')
        if (result === 'wait') break
      }
      if (result === 'wait' && !dirty.has(cardId)) return
    }
  }

  /** Starts a chain for every card with approved children and none running. A store error goes to `onReport`, never to the kick's caller. */
  const startChains = () => {
    try {
      for (const { cardId } of pending()) {
        if (chains.has(cardId)) continue
        const chain = runCard(cardId)
          .catch((error: unknown) => options.onReport?.(error))
          .finally(() => {
            chains.delete(cardId)
            // A kick between the chain's last look and here marked the card but found it still running: look again now.
            if (!closed && dirty.has(cardId)) startChains()
            if (chains.size > 0) return
            running = undefined
            ended?.()
          })
        chains.set(cardId, chain)
      }
    } catch (error) {
      options.onReport?.(error)
    }
    if (chains.size > 0 && running === undefined) running = new Promise<void>((resolve) => (ended = resolve))
  }

  /** Starts chains for cards with none, and asks the running ones to look again. */
  const kick = (): Promise<void> => {
    if (closed) return Promise.resolve()
    for (const cardId of chains.keys()) dirty.add(cardId)
    startChains()
    return running ?? Promise.resolve()
  }

  /**
   * Startup (§6.5): authorizations recovery classified `unknown` look for
   * positive evidence, once, in the background. A miss keeps them unknown.
   * Either way the card's outcome is recorded, so the model learns it (done,
   * or Failed), and a connection call's run goes on with it as it does after
   * a click that ran.
   */
  const reconcile = async () => {
    const unknown = store.db
      .prepare(
        `SELECT authorizations.id AS authorizationId, attempts.id AS attemptId, intents.action_id AS actionId, intents.digest, intents.payload, intents.card_id AS cardId, authorizations.origin_op AS opId
         FROM authorizations JOIN intents ON intents.id = authorizations.intent_id LEFT JOIN attempts ON attempts.authorization_id = authorizations.id
         WHERE authorizations.outcome = 'unknown'`,
      )
      .all() as Array<{ authorizationId: string; attemptId: string | null; actionId: string; digest: string; payload: string; cardId: string; opId: string | null }>
    for (const row of unknown) {
      if (closed) return
      const payload = JSON.parse(row.payload) as ExecutableIdentity
      const found = executor(payload.tool)
      // No attempt: the crash came before the handoff, so there is nothing to look for.
      if (row.attemptId !== null && found?.reconcile !== undefined) {
        const attemptId = row.attemptId
        try {
          const result = await found.reconcile({ ...row, attemptId, payload, opId: row.opId ?? '' })
          if (result._tag === 'found') recordReceipt(store, attemptId, result.receipt)
        } catch (error) {
          options.onReport?.(error)
        }
      }
      settleCard(row.cardId)
      options.onChange()
      options.onSettled?.(row.cardId)
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
