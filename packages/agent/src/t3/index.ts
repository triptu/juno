import { Schema } from 'effect'
import type { Actions, Executor, ExecutorCall } from '../actions'
import { cardRow, memoryGen } from '../actions/cards'
import { mintGrant } from '../grants/grants'
import type { Jobs } from '../jobs/jobs'
import { defineTool, type ToolRun } from '../request/tool'
import type { McpManagerApi } from '../mcp/manager'
import { validateArguments } from '../mcp/catalogue'
import { McpError } from '../mcp/types'
import { LAUNCH, START, Start, startProposal } from './proposal'
import { reconcileStart } from './reconcile'
import { workTools } from './work'
import { stopSession } from './stop'
import { content, launched } from './protocol'
import { proposeQuestions, questionExecutor } from './questions'
import { t3Driver } from './watch'

export function createT3Adapter(manager: McpManagerApi) {
  let bound: { readonly actions: Actions; readonly jobs: Jobs } | undefined
  const attach = (call: ExecutorCall, threadId: string, grant: boolean) => {
    const args = Schema.decodeUnknownSync(Schema.Struct({ projectId: Schema.String, title: Schema.String }))(call.payload.args)
    const card = cardRow(manager.store, call.cardId)
    if (!card || !bound || card.source_gen !== memoryGen(manager.store) || call.payload.account_id !== manager.stored('t3').epoch) return undefined
    const job = bound.jobs.start({
      kind: 't3', runId: card.run_id, originOp: call.opId, callId: call.actionId, title: args.title,
      place: `${args.projectId} · branch pending`,
      task: JSON.stringify({ threadId, project: args.projectId, epoch: call.payload.account_id }),
    })
    if (grant) mintGrant(manager.store, { opClass: 'job', target: job.id, authority: { _tag: 'click', current: true }, sourceOp: call.opId })
    return job
  }
  const check: NonNullable<Executor['check']> = async (payload) => {
    if (payload.connection_id !== 't3') return 'connectionChanged'
    if (payload.account_id !== manager.stored('t3').epoch) return 'accountChanged'
    if (manager.state('t3') !== 'ready') return 'preconditionFailed'
    try {
      if (manager.tool('t3', LAUNCH).hash !== payload.schema_hash) return 'schemaChanged'
      validateArguments(manager.tool('t3', LAUNCH).definition, payload.args)
      await manager.checkSecrets(payload.args)
      return 'valid'
    } catch { return 'preconditionFailed' }
  }
  const executor: Executor = {
    tool: START, tier: 2, deduped: false, check,
    run: async (call) => {
      if (!bound || await check(call.payload) !== 'valid') return { _tag: 'failed', detail: 'T3 Code or its launch tool changed. Ask for a new card.' }
      try {
        const result = launched(content(await manager.invoke('t3', LAUNCH, call.payload.args, true)))
        const job = attach(call, result.threadId, true)
        if (!job) return { _tag: 'unknown', detail: 'The session started but its card is unavailable.' }
        return { _tag: 'done', receipt: { threadId: result.threadId, jobId: job.id } }
      } catch { return { _tag: 'unknown', detail: 'T3 Code did not confirm the start. Check T3 Code before asking for another card.' } }
    },
    reconcile: async (call) => {
      const result = await reconcileStart(manager, call)
      if (result._tag === 'found') attach(call, result.receipt.threadId, false)
      return result
    },
  }
  return {
    executors: [executor, questionExecutor(manager)],
    stop: async (job: Parameters<typeof stopSession>[2]) => bound ? stopSession(manager, bound.actions, job) : false,
    driver: t3Driver(manager, async (job, threadId, signal) => { if (bound) await proposeQuestions(manager, bound.actions, job, threadId, signal) }),
    tools: (context: { readonly actions: Actions; readonly jobs: Jobs; readonly current: () => Promise<ToolRun | undefined> }) => {
      bound = context
      return [...workTools(manager, context), defineTool<Start>({
        name: START, description: 'Propose a T3 Code session. Always needs the owner to click Start. Choose the project id and base branch. The session has full access in a new worktree. Use replaces to correct an open proposal.',
        replay: 'safe', status: () => 'Proposing a task',
        parameters: { type: 'object', properties: { project: { type: 'string' }, baseBranch: { type: 'string' }, title: { type: 'string' }, brief: { type: 'string' }, planFirst: { type: 'boolean' }, replaces: { type: 'string' } }, required: ['project', 'baseBranch', 'title', 'brief', 'planFirst'], additionalProperties: false },
        run: async (args, call) => {
          const run = await context.current()
          if (!run) return { text: 'No active run.', isError: true }
          try {
            const input = Schema.decodeUnknownSync(Start)(args)
            const existing = manager.store.db.prepare('SELECT id FROM cards WHERE call_id = ?').get(call.callId)
            if (typeof existing?.id === 'string') return { text: `Proposed task ${existing.id}. Nothing starts until the owner clicks Start.` }
            const proposal = await startProposal(manager, input, { runId: run.runId, callId: call.callId })
            if (input.replaces !== undefined) {
              const old = context.actions.views().find((view) => view.card.id === input.replaces)
              if (old?.card._tag !== 'proposedTask' || old.card.kind !== 't3' || !old.binding) throw new McpError({ reason: 'stale', message: 'Only an open T3 Code proposal can be replaced.' })
            }
            const id = context.actions.propose(proposal)
            return { text: `Proposed task ${id}. Nothing starts until the owner clicks Start.` }
          } catch (error) { return { text: error instanceof McpError ? error.message : 'T3 Code has an unsupported tool schema or arguments. No session was started.', isError: true } }
        },
      })]
    },
  }
}
