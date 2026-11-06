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
 * The drain runs each card's approved children in click order, one at a
 * time, so a batch reaches its destination in the card's order; cards run
 * beside each other, so a click that waits (a connection not ready, a
 * sign-in in progress) holds no other card. Before each child it checks the
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
  let running: Promise<void> | undefined
  /** A kick arrived: read the approvals again. */
  let again = false
  /** Wakes the drain when a card's chain ends or a kick arrives. */
  let wake: (() => void) | undefined
  /** The chain running each card's children now. */
  const chains = new Map<string, Promise<void>>()

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

  /** One card's approved children in click order; the rest of the card waits with the first child that must. */
  const runCard = async (items: ReadonlyArray<Pending>) => {
    for (const item of items) {
      let result: Awaited<ReturnType<typeof dispatch>>
      do {
        if (closed) return
        result = await dispatch(item)
      } while (result === 'rotated')
      if (result !== 'done') return
    }
  }

  /** Starts a chain for every card with approved children and none running. */
  const startChains = () => {
    const byCard = new Map<string, Pending[]>()
    for (const item of pending()) {
      if (chains.has(item.cardId)) continue
      byCard.set(item.cardId, [...(byCard.get(item.cardId) ?? []), item])
    }
    for (const [cardId, items] of byCard) {
      const chain = runCard(items)
        .catch((error: unknown) => options.onReport?.(error))
        .finally(() => {
          chains.delete(cardId)
          wake?.()
        })
      chains.set(cardId, chain)
    }
  }

  /** Runs the cards' chains until every one ended and no kick is waiting. A kick meanwhile reads the approvals again. */
  const drain = async () => {
    for (;;) {
      if (closed) break
      if (again) {
        again = false
        startChains()
      }
      if (chains.size === 0 && !again) return
      if (!again) await new Promise<void>((resolve) => (wake = resolve))
      wake = undefined
    }
    await Promise.all(chains.values())
  }

  /** Runs the drain, or asks the running one to look again. */
  const kick = (): Promise<void> => {
    if (closed) return Promise.resolve()
    again = true
    if (running !== undefined) {
      wake?.()
      return running
    }
    running = drain()
      .catch((error: unknown) => options.onReport?.(error))
      .finally(() => {
        running = undefined
        // A kick that landed as the drain ended starts the next one.
        if (again && !closed) void kick()
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
      wake?.()
      await running
    },
  }
}
