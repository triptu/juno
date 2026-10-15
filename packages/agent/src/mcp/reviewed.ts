/**
 * The auto-review's two halves for `call_tool` (SPEC 13.9; spec
 * `reviewAllows`): deciding a connection call that is not a read, and running
 * one the review let run with no click.
 */
import { Schema } from 'effect'
import { CardPayload } from '@juno/agent-cards'
import type { ToolReview } from '@juno/agent-cards/presentation'
import { chatCopy, type ReviewRule } from '@juno/agent-contract'
import { cardRow, intentOf, memoryGen, payloadOf } from '../actions/cards'
import { authorityOf } from '../grants/grants'
import { authorizeDecision, floorRisk, needsReview, reviewDecision, type Review, type ReviewLine } from '../policy/policy'
import type { ToolCall, ToolRun } from '../request/tool'
import { ownerWordsInRun, reviewCall, reviewRequest } from '../review/review'
import { capOf } from '../settings/store'
import { createSpend } from '../spend'
import { authorize, recordAttempt, recordReceipt, settleAuthorization } from '../store/ledger'
import { uuidv7 } from '../store/store'
import { looksDestructive, mcpExecutors, runWrite } from './actions'
import type { McpManagerApi } from './manager'
import { result } from './results'
import type { McpToolsContext } from './tools'
import { T3, destructiveArguments } from './types'

type Change = Extract<CardPayload, { _tag: 'change' }>

/**
 * The rule a call follows (SPEC 13.9): T3 Code's tools that are not reads, and
 * a call whose arguments delete, always ask; otherwise the owner's rule for
 * the tool, read now.
 */
export function ruleFor(manager: McpManagerApi, server: string, tool: string, args: unknown): ReviewRule {
  // T3 Code can start and steer sessions under many names, and a session always takes a click (SPEC 13.4).
  if (server === T3.id || destructiveArguments(args)) return 'always'
  return manager.rule(server, tool)
}

const withReview = (proposed: Change, rule: ReviewRule, review: Review, line: ReviewLine) => {
  const record: ToolReview = {
    rule, ...(review._tag === 'answered' ? { intent: review.intent, risk: review.risk } : {}), ...(review._tag === 'failed' ? { failed: true as const } : {}),
    line: chatCopy.card.change.review[line],
  }
  return { line: record.line, payload: Schema.decodeUnknownSync(CardPayload)({ ...proposed, review: record }) }
}

/**
 * The owner's rule for the tool, the review when the rule needs one, and the
 * decision, with the review recorded on the payload the card shows.
 */
export async function reviewChange(manager: McpManagerApi, context: McpToolsContext, run: ToolRun, tool: string, proposed: Change) {
  const server = proposed.action.payload.connection_id
  const args = proposed.action.payload.args
  const rule = ruleFor(manager, server, tool, args)
  // What the model had read when it wrote this call; this call's own taint came after.
  const clean = run.cleanAtRequest ?? run.clean
  const answered = needsReview(rule, clean)
    ? await reviewCall({
      model: context.review,
      spend: createSpend(manager.store, () => capOf(manager.store)),
      ...(context.reviewTimeoutMs === undefined ? {} : { timeoutMs: context.reviewTimeoutMs }),
      request: reviewRequest(ownerWordsInRun(manager.store, run.runId), { server: proposed.server, tool, args }),
    })
    : { _tag: 'skipped' as const }
  const destructive = looksDestructive(manager, server, tool, args)
  const review = floorRisk(answered, destructive)
  const decision = reviewDecision(rule, clean, review)
  // A delete always asks whatever the owner's rule, so its line says why.
  const line = decision.line === 'always' && destructive ? 'delete' : decision.line
  return { decision: decision._tag, rule, clean, review, proposed, ...withReview(proposed, rule, review, line) }
}

/**
 * A call the review let run: a quiet card holds its intent, `mcp_reviews` its
 * authority, and it is authorized, attempted and settled as a click would be.
 * It runs once; nothing retries it. The owner's rule is read again just before
 * it is authorized, with nothing awaited in between: a rule made stricter
 * during the review asks instead (spec `reviewAllows`, read at authorization).
 */
export async function runReviewed(manager: McpManagerApi, context: McpToolsContext, reviewed: Awaited<ReturnType<typeof reviewChange>>, run: ToolRun, call: ToolCall, name: string) {
  const { store } = manager
  const { proposed } = reviewed
  const executor = mcpExecutors(manager).find((e) => e.tool === proposed.action.payload.tool)
  const valid = executor === undefined ? 'stale' : await executor.check?.(proposed.action.payload) ?? 'valid'
  const current = await context.current()
  const rule = ruleFor(manager, proposed.action.payload.connection_id, name, proposed.action.payload.args)
  const now = reviewDecision(rule, reviewed.clean, reviewed.review)
  if (now._tag === 'card') {
    // A rule that now needs a review the call never had says so; otherwise the new rule's own line.
    const asked = withReview(proposed, rule, reviewed.review, reviewed.review._tag === 'skipped' && rule !== 'always' ? 'ruleChanged' : now.line)
    const id = context.actions.propose({ runId: run.runId, callId: call.callId, payload: asked.payload })
    return { text: `Proposed Change card ${id}. Nothing runs until the owner clicks. ${asked.line}` }
  }
  const id = context.actions.propose({ runId: run.runId, callId: call.callId, payload: reviewed.payload, quiet: true })
  const card = cardRow(store, id)!
  const stored = payloadOf(store, card)
  if (stored._tag !== 'change') throw new Error('Expected a change')
  if (card.quiet === 0) return { text: `Proposed Change card ${id}. Nothing runs until the owner clicks.` }
  const intent = intentOf(store, stored.action.id, stored.action.rev)!
  if (store.db.prepare('SELECT 1 FROM authorizations WHERE intent_id = ?').get(intent.id) !== undefined) return { text: 'This call was already made once. Juno does not repeat it.', isError: true }
  const decision = authorizeDecision({
    authority: authorityOf(store), intent: { rev: intent.rev, digest: intent.digest, tier: 3, deduped: false },
    validity: intent.source !== memoryGen(store) ? 'sourceChanged' : valid === 'wait' ? 'preconditionFailed' : valid,
    grant: false, review: true, prior: [], done: false,
  })
  const refuse = (text: string) => {
    store.db.prepare('UPDATE cards SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL').run(store.now(), id)
    context.actions.changed()
    return { text, isError: true }
  }
  if (decision._tag !== 'authorize' || current === undefined) return refuse('Nothing was done: Juno is paused, or the connection or tool changed.')
  const reviewId = uuidv7(store.now())
  store.db.prepare('INSERT INTO mcp_reviews (id, card_id, source_op, at) VALUES (?, ?, ?, ?)').run(reviewId, id, run.opId, store.now())
  const auth = authorize(store, { intentId: intent.id, grantId: reviewId, originOp: run.opId, position: current.position })
  if (auth._tag !== 'authorized') return refuse('Nothing was done: Juno cannot act right now.')
  const attempt = recordAttempt(store, auth.id)
  if (attempt === undefined) return refuse('Nothing was done: the call was cancelled before it was sent.')
  const ran = await runWrite(manager, stored.action.payload.connection_id, name, stored.action.payload)
  if (ran.result._tag === 'done') recordReceipt(store, attempt, ran.result.receipt)
  else settleAuthorization(store, auth.id, ran.result._tag, ran.result.detail)
  context.actions.changed()
  if (ran.value !== undefined) return { ...result(JSON.stringify(ran.value)), ...(ran.value.isError ? { isError: true } : {}) }
  return { text: ran.result._tag === 'failed' ? 'The connection or tool changed. Nothing was sent.' : 'The server did not confirm the call. Juno will not try it again.', isError: true }
}
