import { Schema } from 'effect'
import { CardPayload, actionDigest } from '@juno/agent-cards'
import type { Actions } from '../actions'
import { cardRow, intentOf, payloadOf, memoryGen, expiry } from '../actions/cards'
import { authorityOf, liveGrant } from '../grants/grants'
import type { Jobs } from '../jobs/jobs'
import { authorizeDecision, toolDecision } from '../policy/policy'
import { defineTool, type ToolRun } from '../request/tool'
import { authorize, recordAttempt, recordReceipt } from '../store/ledger'
import { changeCard, mcpExecutors } from '../mcp/actions'
import type { McpManagerApi } from '../mcp/manager'
import { sessionOf } from './protocol'

const Work = Schema.Struct({ job: Schema.String, message: Schema.optionalKey(Schema.String) })

/** Grant-backed work still records its intent and attempt before touching MCP. */
export function workTools(manager: McpManagerApi, context: { readonly jobs: Jobs; readonly actions: Actions; readonly current: () => Promise<ToolRun | undefined> }) {
  return (['send', 'stop'] as const).map((operation) => defineTool<typeof Work.Type>({
    name: `t3_${operation}`, replay: 'unsafe', status: () => operation === 'send' ? 'Sending task instructions' : 'Stopping a task',
    description: operation === 'send' ? 'Send instructions to a Juno T3 job. A clean owner request with its live grant runs once; otherwise proposes a Change card.' : 'Stop a Juno T3 job under its live grant in a clean owner request. Otherwise point to the Task card Stop button.',
    parameters: { type: 'object', properties: { job: { type: 'string' }, ...(operation === 'send' ? { message: { type: 'string' } } : {}) }, required: operation === 'send' ? ['job', 'message'] : ['job'], additionalProperties: false },
    run: async (input, call) => {
      try {
        const args = Schema.decodeUnknownSync(Work)(input)
        const run = await context.current()
        const job = context.jobs.get(args.job)
        if (!run || job?.kind !== 't3' || ['done', 'failed', 'stopped', 'unknown'].includes(job.phase)) return { text: 'This T3 Code job is unavailable.', isError: true }
        const session = sessionOf(job.task)
        if (session.epoch !== manager.stored('t3').epoch) return { text: 'The T3 Code connection changed. Check the session.', isError: true }
        const decision = toolDecision(operation === 'send' ? 'steer' : 'stopJob', run, { liveGrant: liveGrant(manager.store, 'job', job.id) !== undefined })
        if (decision._tag === 'refused') return { text: 'Use Stop on the Task card.', isError: true }
        if (operation === 'send' && !args.message?.trim()) return { text: 'The task instruction is empty.', isError: true }
        const proposed = await changeCard(manager, 't3', operation === 'send' ? 't3_thread_send' : 't3_thread_interrupt', {
          threadId: session.threadId, ...(operation === 'send' ? { message: args.message } : {}),
        })
        if (proposed._tag !== 'change') throw new Error('Expected change')
        const payload = decision._tag === 'card' ? proposed : Schema.decodeUnknownSync(CardPayload)({ ...proposed, action: { ...proposed.action, tier: 2 } })
        const id = context.actions.propose({ runId: run.runId, callId: call.callId, payload })
        if (decision._tag === 'card') return { text: `Proposed Change card ${id}. Nothing is sent until the owner clicks.` }
        const stored = payloadOf(manager.store, cardRow(manager.store, id)!)
        if (stored._tag !== 'change' || stored.action.tier !== 2 || actionDigest(stored.action.payload) !== actionDigest(proposed.action.payload)) throw new Error('The stored action changed')
        const intent = intentOf(manager.store, stored.action.id, stored.action.rev)!
        const executor = mcpExecutors(manager).find((e) => e.tool === stored.action.payload.tool)
        if (!executor) throw new Error('Missing executor')
        const valid = await executor.check?.(stored.action.payload) ?? 'valid'
        const current = await context.current()
        const grant = liveGrant(manager.store, 'job', job.id)
        const prior = manager.store.db.prepare('SELECT 1 FROM authorizations WHERE intent_id = ?').get(intent.id)
        const allowed = authorizeDecision({ authority: authorityOf(manager.store), intent: { rev: intent.rev, digest: intent.digest, tier: 2, deduped: false },
          validity: intent.source !== memoryGen(manager.store) ? 'sourceChanged' : expiry(manager.store, cardRow(manager.store, id)!, manager.store.now()) ?? (valid === 'wait' ? 'preconditionFailed' : valid), grant: current?.clean === true && current.origin === 'owner' && grant !== undefined,
          prior: prior ? [intent.digest] : [], done: false })
        if (allowed._tag !== 'authorize' || !current || !grant) return { text: 'The job grant is no longer available. Nothing was sent.', isError: true }
        const auth = authorize(manager.store, { intentId: intent.id, grantId: grant.id, originOp: run.opId, position: current.position })
        if (auth._tag !== 'authorized') return { text: 'Juno cannot act right now.', isError: true }
        const attempt = recordAttempt(manager.store, auth.id)
        if (!attempt) return { text: 'The action was cancelled before sending.', isError: true }
        const result = await executor.run({ actionId: stored.action.id, authorizationId: auth.id, attemptId: attempt, digest: intent.digest, payload: stored.action.payload, cardId: id, opId: run.opId })
        if (result._tag === 'done') recordReceipt(manager.store, attempt, result.receipt)
        else manager.store.db.prepare('UPDATE authorizations SET outcome = ? WHERE id = ?').run(result._tag, auth.id)
        context.actions.changed()
        if (result._tag !== 'done') return { text: 'T3 Code did not confirm the action. Check the session; Juno will not retry.', isError: true }
        if (operation === 'stop') { context.actions.jobStopped(job.id); await context.jobs.stop(job.id) }
        return { text: operation === 'send' ? 'Sent the task instructions.' : 'Stopped the task.' }
      } catch { return { text: 'T3 Code is unavailable or its tool schema is unsupported. No retry was made.', isError: true } }
    },
  }))
}

