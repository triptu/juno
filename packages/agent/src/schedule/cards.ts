import { Schema } from 'effect'
import { CardPayload, digestJson } from '@juno/agent-cards'
import { memoryGen, type Proposal } from '../actions/cards'
import type { Executor } from '../actions/executor'
import { toolDecision } from '../policy/policy'
import { defineTool, type ToolRun } from '../request/tool'
import { uuidv7, type Store } from '../store/store'
import { Definition } from './rules'
import { describeWhen, type ScheduleRecord, type Scheduler } from './scheduler'

const CREATE = 'schedule_create'
const ACTION = 'schedule_action'
const HASH = digestJson({ version: 1, tools: [CREATE, ACTION] })
const decode = Schema.decodeUnknownSync(CardPayload)
function card(store: Store, definition: Definition, current?: ScheduleRecord): CardPayload {
  return decode({ _tag: current === undefined ? 'proposedSchedule' : 'schedule',
    what: definition.what, when: describeWhen(definition), deliver: definition.deliver,
    ...(current === undefined ? { prompt: definition.prompt } : { scheduleId: current.id }),
    action: { id: uuidv7(store.now()), rev: 1, tier: 1, deduped: true, source: memoryGen(store), payload: {
      connection_id: 'juno', account_id: 'owner', destination_ids: [], tool: current === undefined ? CREATE : ACTION,
      schema_hash: HASH, args: current === undefined ? { definition } : { id: current.id, revision: current.revision }, preconditions: {}, ops: [],
    } },
  })
}
export function proposedScheduleCard(store: Store, definition: Definition): CardPayload { return card(store, definition) }
export function scheduleCard(store: Store, current: ScheduleRecord): CardPayload { return card(store, current.definition, current) }
export interface ScheduleCards {
  readonly store: Store
  readonly scheduler: Scheduler
  readonly propose: (proposal: Proposal) => string
}
export function scheduleExecutors(context: ScheduleCards): ReadonlyArray<Executor> {
  const { scheduler, store } = context
  return [
    { tool: CREATE, tier: 1, deduped: true, check: async (p) => p.schema_hash === HASH ? 'valid' : 'schemaChanged',
      run: async (call) => {
        const { definition } = Schema.decodeUnknownSync(Schema.Struct({ definition: Definition }))(call.payload.args)
        const row = scheduler.create({ key: call.actionId, sourceOp: call.opId, authority: { _tag: 'click', current: true }, definition })
        if (row === undefined) return { _tag: 'failed', detail: 'The schedule could not start.' }
        context.propose({ runId: `schedule:${row.id}`, callId: `schedule-card:${row.id}`, payload: scheduleCard(store, row) })
        return { _tag: 'done', receipt: { scheduleId: row.id } }
      },
    },
    { tool: ACTION, tier: 1, deduped: true, check: async (p) => p.schema_hash === HASH ? 'valid' : 'schemaChanged',
      run: async (call) => {
        const args = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, revision: Schema.Int,
          choice: Schema.Struct({ action: Schema.Literals(['keep', 'pause', 'delete']) }) }))(call.payload.args)
        const row = scheduler.get(args.id)
        if (row === undefined || row.revision !== args.revision) return { _tag: 'failed', detail: 'The schedule changed.' }
        if (args.choice.action !== 'keep') scheduler.cancel(args.id, args.revision, args.choice.action === 'pause' ? 'paused' : 'deleted')
        return { _tag: 'done', receipt: { scheduleId: args.id, action: args.choice.action } }
      },
    },
  ]
}
export function scheduleCreateTool(context: ScheduleCards & { readonly current: () => Promise<ToolRun | undefined> }) {
  return defineTool<Definition>({
    name: CREATE, description: 'Create a schedule requested by the owner. A reply watch must be once, with unlessReply. A tainted owner run proposes a card for approval.',
    parameters: { type: 'object', properties: {
      what: { type: 'string' }, prompt: { type: 'string' }, deliver: { enum: ['now', 'digest', 'silent'] },
      schedule: { oneOf: [
        { type: 'object', properties: { _tag: { const: 'once' }, at: { type: 'number' } }, required: ['_tag', 'at'], additionalProperties: false },
        { type: 'object', properties: { _tag: { const: 'interval' }, everyMs: { type: 'integer', minimum: 1 } }, required: ['_tag', 'everyMs'], additionalProperties: false },
        { type: 'object', properties: { _tag: { const: 'wallClock' }, time: { type: 'string' }, timeZone: { type: 'string' }, weekdays: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 }, minItems: 1 } }, required: ['_tag', 'time', 'timeZone', 'weekdays'], additionalProperties: false },
      ] },
      unlessReply: { type: 'object', properties: { channelId: { type: 'string' }, ts: { type: 'string' }, threadTs: { type: 'string' }, from: { oneOf: [{ const: 'others' }, { type: 'array', items: { type: 'string' } }] } }, required: ['channelId', 'ts', 'from'], additionalProperties: false },
    }, required: ['what', 'prompt', 'schedule', 'deliver'], additionalProperties: false },
    replay: 'safe', status: () => 'Setting a schedule', run: async (input, call) => {
      const run = await context.current()
      if (run === undefined) return { text: 'No active run.', isError: true }
      const decision = toolDecision('scheduleCreate', run)
      if (decision._tag === 'refused') return { text: 'Only the owner can create a schedule.', isError: true }
      const definition = Schema.decodeUnknownSync(Definition)(input)
      if (decision._tag === 'card') {
        const id = context.propose({ runId: run.runId, callId: call.callId, payload: card(context.store, definition) })
        return { text: `Proposed schedule ${id}. It waits for Start.` }
      }
      const row = context.scheduler.create({ key: call.callId, sourceOp: run.opId, authority: { _tag: 'cleanRun', run, sourceInRun: true }, definition })
      if (row === undefined) return { text: 'The schedule could not start.', isError: true }
      context.propose({ runId: run.runId, callId: `schedule-card:${row.id}`, payload: scheduleCard(context.store, row) })
      return { text: `Created schedule ${row.id}.` }
    },
  })
}

/** A wake can only pause or delete its own schedule. It cannot resume or replace it. */
export function ownScheduleTool(context: ScheduleCards & { readonly current: () => Promise<ToolRun | undefined> }) {
  return defineTool<{ readonly id: string; readonly action: 'pause' | 'delete' }>({
    name: 'schedule_change', description: 'Pause or delete a schedule. A wake may only change the schedule that woke it.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, action: { enum: ['pause', 'delete'] } }, required: ['id', 'action'], additionalProperties: false },
    replay: 'safe', status: () => 'Updating a schedule', run: async ({ id, action }) => {
      const run = await context.current()
      if (run === undefined) return { text: 'No active run.', isError: true }
      const op = context.store.db.prepare('SELECT data FROM inbox WHERE op_id = ?').get(run.opId)
      const data = typeof op?.data === 'string' ? Schema.decodeUnknownSync(Schema.Struct({ scheduleId: Schema.optionalKey(Schema.String) }))(JSON.parse(op.data)) : undefined
      if (toolDecision('ownSchedule', run, { wokeThisRun: data?.scheduleId === id })._tag !== 'run') return { text: 'This run cannot change that schedule.', isError: true }
      const row = context.scheduler.get(id)
      if (row === undefined || row.state === 'deleted') return { text: 'The schedule is already deleted.' }
      context.scheduler.cancel(id, row.revision, action === 'pause' ? 'paused' : 'deleted')
      return { text: action === 'pause' ? 'Paused the schedule.' : 'Deleted the schedule.' }
    },
  })
}
