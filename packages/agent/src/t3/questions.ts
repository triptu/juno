import { Schema } from 'effect'
import { CardPayload } from '@juno/agent-cards'
import type { Actions, Executor } from '../actions'
import type { Job } from '../jobs/jobs'
import { memoryGen } from '../actions/cards'
import { uuidv7 } from '../store/store'
import { validateArguments } from '../mcp/catalogue'
import type { McpManagerApi } from '../mcp/manager'
import { content } from './protocol'

const RESPOND = 't3_pending_request_respond'
const ANSWER = 't3_respond'
const Request = Schema.Struct({
  requestId: Schema.String,
  questions: Schema.Array(Schema.Struct({
    id: Schema.String, question: Schema.String,
    allowCustomAnswer: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
    multiSelect: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
    options: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.optionalKey(Schema.NullOr(Schema.String)) })),
  })),
})
const Answer = Schema.Struct({
  threadId: Schema.String, requestId: Schema.String, questionId: Schema.String,
  options: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })),
  choice: Schema.Struct({ answer: Schema.Union([
    Schema.TaggedStruct('text', { text: Schema.String }), Schema.TaggedStruct('option', { optionId: Schema.String }),
  ]) }),
})
function answerArgs(args: unknown) {
  const input = Schema.decodeUnknownSync(Answer)(args)
  const choice = input.choice.answer
  const value = choice._tag === 'text' ? choice.text : input.options.find((o) => o.id === choice.optionId)?.value
  if (value === undefined) throw new Error('Unknown answer')
  return { threadId: input.threadId, requestId: input.requestId, answers: { [input.questionId]: value } }
}

/** `answered` wakes the session's watcher, so the Task card leaves needs-you without waiting for the next read. */
export function questionExecutor(manager: McpManagerApi, answered: (threadId: string) => void): Executor {
  const check: NonNullable<Executor['check']> = async (payload) => {
    if (payload.connection_id !== 't3' || payload.account_id !== manager.stored('t3').epoch) return 'accountChanged'
    try {
      if (manager.tool('t3', RESPOND).hash !== payload.schema_hash) return 'schemaChanged'
      validateArguments(manager.tool('t3', RESPOND).definition, answerArgs(payload.args))
      return manager.state('t3') === 'ready' ? 'valid' : 'preconditionFailed'
    } catch { return 'preconditionFailed' }
  }
  return {
    tool: ANSWER, tier: 3, deduped: false, check,
    run: async ({ payload }) => {
      if (await check(payload) !== 'valid') return { _tag: 'failed', detail: 'This T3 Code question changed.' }
      try {
        const args = answerArgs(payload.args)
        content(await manager.invoke('t3', RESPOND, args, 'write'))
        answered(args.threadId)
        return { _tag: 'done', receipt: { confirmed: true } }
      } catch { return { _tag: 'unknown', detail: 'T3 Code did not confirm the answer. Check the session.' } }
    },
    reconcile: async () => ({ _tag: 'unknown' }),
  }
}

/**
 * Unknown question shapes remain in T3; never invent approval answers.
 * Returns shown: false when a pending question has no card, so the job can say to answer it in T3 Code.
 */
export async function proposeQuestions(manager: McpManagerApi, actions: Actions, job: Job, threadId: string, signal: AbortSignal): Promise<{ readonly shown: boolean; readonly requestIds: ReadonlyArray<string> }> {
  const source = memoryGen(manager.store)
  const epoch = manager.stored('t3').epoch
  const list = Schema.decodeUnknownSync(Schema.Struct({ requestIds: Schema.Array(Schema.String) }))(
    content(await manager.invoke('t3', 't3_pending_request_list', { threadId })),
  )
  let shown = true
  for (const requestId of list.requestIds) {
    const callId = `t3-question:${threadId}:${requestId}`
    if (manager.store.db.prepare('SELECT 1 FROM cards WHERE call_id = ?').get(callId)) continue
    const request = Schema.decodeUnknownSync(Request)(content(await manager.invoke('t3', 't3_pending_request_read', { threadId, requestId })))
    const q = request.questions[0]
    if (request.requestId !== requestId || request.questions.length !== 1 || !q || q.multiSelect || q.options.length < 2 || q.options.length > 4) {
      shown = false
      continue
    }
    const tool = manager.tool('t3', RESPOND)
    const options = q.options.map((o, i) => ({ id: `option-${i}`, label: o.label, value: o.value ?? o.label }))
    if (signal.aborted || source !== memoryGen(manager.store) || epoch !== manager.stored('t3').epoch) return { shown, requestIds: list.requestIds }
    actions.propose({ runId: job.runId, callId, payload: Schema.decodeUnknownSync(CardPayload)({
      _tag: 'question', asks: { _tag: 't3', job: { jobId: job.id, title: job.title } },
      prompt: q.question, options: options.map(({ id, label }) => ({ id, label })), freeText: q.allowCustomAnswer === true,
      action: { id: uuidv7(manager.store.now()), rev: 1, tier: 3, deduped: false, source: memoryGen(manager.store),
        payload: { connection_id: 't3', account_id: manager.stored('t3').epoch, destination_ids: [threadId, requestId], tool: ANSWER, schema_hash: tool.hash,
          args: { threadId, requestId, questionId: q.id, options: options.map(({ id, value }) => ({ id, value })) }, preconditions: {}, ops: [] } },
    }) })
  }
  return { shown, requestIds: list.requestIds }
}
