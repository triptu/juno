import { Context, Effect, Layer, Schema } from 'effect'
import { Revision } from '@juno/agent-cards'
import { ScheduleId } from '@juno/agent-contract'
import { authorityOf, liveGrant, mintGrant, revokeGrant } from '../grants/grants'
import { mayAuthorize, type GrantAuthority } from '../policy/policy'
import { transaction } from '../store/database'
import { uuidv7, type Store } from '../store/store'
import { Definition, matchesReply, menuDeadline, nextDue, NUDGE_PROMPT, type NotificationHours, type Reply, type ReplyWatch } from './rules'

const Row = Schema.Struct({ id: Schema.String, revision: Schema.Int, definition: Schema.String,
  state: Schema.Literals(['active', 'paused', 'deleted']), due_at: Schema.Number, source_op: Schema.String, creation_key: Schema.String })
const Occurrence = Schema.Struct({ schedule_id: Schema.String, revision: Schema.Int, due_at: Schema.Number,
  op_id: Schema.String, state: Schema.Literals(['queued', 'admitted', 'started', 'cancelled']) })
export type Occurrence = typeof Occurrence.Type
const decodeRow = Schema.decodeUnknownSync(Row)
const decodeOccurrence = Schema.decodeUnknownSync(Occurrence)
const decodeDefinition = Schema.decodeUnknownSync(Definition)
export type ScheduleRecord = ReturnType<typeof record>
function record(row: typeof Row.Type) {
  return { id: row.id, revision: row.revision, definition: decodeDefinition(JSON.parse(row.definition)), state: row.state, dueAt: row.due_at }
}
export interface SchedulerOptions {
  readonly store: Store
  /** Refresh the whole conversation before returning replies; failures must reject. */
  readonly replies: (watch: ReplyWatch) => Promise<{ readonly owner: string; readonly messages: ReadonlyArray<Reply> }>
  readonly changed: () => void
}

export function createScheduler(options: SchedulerOptions) {
  const { store } = options
  const get = (id: string) => {
    const row = store.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
    return row === undefined ? undefined : record(decodeRow(row))
  }
  const list = () => store.db.prepare("SELECT * FROM schedules WHERE state != 'deleted' ORDER BY due_at, id").all().map((r) => record(decodeRow(r)))
  const occurrences = () => store.db.prepare('SELECT * FROM schedule_occurrences ORDER BY due_at, op_id').all().map((row) => decodeOccurrence(row))
  function valid(occurrence: Occurrence): ScheduleRecord | undefined {
    const current = get(occurrence.schedule_id)
    const grant = liveGrant(store, 'schedule', occurrence.schedule_id)
    if (current === undefined || current.state !== 'active' || current.revision !== occurrence.revision ||
      !mayAuthorize(authorityOf(store)) || grant === undefined) return undefined
    const bounds = Schema.decodeUnknownSync(Schema.Struct({ revision: Schema.Int, purpose: Schema.String }))(grant.bounds)
    return bounds.revision === current.revision && bounds.purpose === current.definition.prompt ? current : undefined
  }
  function create(input: { readonly key: string; readonly sourceOp: string; readonly authority: GrantAuthority; readonly definition: Definition }) {
    return transaction(store.db, () => {
    const definition = decodeDefinition(input.definition)
    if (definition.unlessReply !== undefined && definition.schedule._tag !== 'once') return undefined
    const previous = store.db.prepare('SELECT * FROM schedules WHERE creation_key = ?').get(input.key)
    if (previous !== undefined) return record(decodeRow(previous))
    const id = uuidv7(store.now())
    const grant = mintGrant(store, { opClass: 'schedule', target: id, bounds: { revision: 1, purpose: definition.prompt }, authority: input.authority, sourceOp: input.sourceOp })
    if (grant._tag === 'refused') return undefined
    store.db.prepare('INSERT INTO schedules VALUES (?, 1, ?, ?, ?, ?, ?)')
      .run(id, JSON.stringify(definition), 'active', nextDue(definition.schedule, store.now()), input.sourceOp, input.key)
    if (input.authority._tag === 'menu') store.db.prepare("INSERT OR IGNORE INTO inbox (op_id, kind, text, data, at, state) VALUES (?, 'click', '', ?, ?, 'done')").run(input.sourceOp, JSON.stringify({ scheduleId: id, action: 'watchReply' }), store.now())
    options.changed()
    return get(id)
    })
  }
  function cancel(id: string, revision: number, state: 'paused' | 'deleted' = 'deleted'): boolean {
    const changed = transaction(store.db, () => {
      const row = get(id)
      if (row === undefined || row.revision !== revision || row.state === 'deleted') return false
      revokeGrant(store, 'schedule', id, 'delete')
      store.db.prepare('UPDATE schedules SET state = ?, revision = revision + 1 WHERE id = ?').run(state, id)
      store.db.prepare("UPDATE schedule_occurrences SET state = 'cancelled' WHERE schedule_id = ? AND state IN ('queued','admitted')").run(id)
      store.db.prepare("UPDATE inbox SET state = 'interrupted', reason = 'schedule cancelled', ended_at = ? WHERE state = 'accepted' AND op_id IN (SELECT op_id FROM schedule_occurrences WHERE schedule_id = ? AND state = 'cancelled')").run(store.now(), id)
      return true
    })
    if (changed) options.changed()
    return changed
  }
  function resume(id: string, revision: number, sourceOp: string): boolean {
    return transaction(store.db, () => {
    const row = get(id)
    if (row === undefined || row.revision !== revision || row.state === 'deleted' || !mayAuthorize(authorityOf(store))) return false
    // A new explicit click is required. Global Resume never calls this method.
    revokeGrant(store, 'schedule', id, 'delete')
    const next = revision + 1
    const grant = mintGrant(store, { opClass: 'schedule', target: id, bounds: { revision: next, purpose: row.definition.prompt }, authority: { _tag: 'click', current: true }, sourceOp })
    if (grant._tag === 'refused') return false
    store.db.prepare("UPDATE schedules SET state = 'active', revision = ?, due_at = ?, source_op = ? WHERE id = ?")
      .run(next, nextDue(row.definition.schedule, store.now()), sourceOp, id)
    options.changed()
    return true
    })
  }
  function edit(id: string, revision: number, sourceOp: string, definition: Definition): boolean {
    const next = decodeDefinition(definition)
    if (next.unlessReply !== undefined && next.schedule._tag !== 'once') return false
    return transaction(store.db, () => {
      const row = get(id)
      if (row === undefined || row.revision !== revision || row.state === 'deleted' || !mayAuthorize(authorityOf(store))) return false
      revokeGrant(store, 'schedule', id, 'delete')
      const grant = mintGrant(store, { opClass: 'schedule', target: id, bounds: { revision: revision + 1, purpose: next.prompt }, authority: { _tag: 'click', current: true }, sourceOp })
      if (grant._tag === 'refused') return false
      store.db.prepare("UPDATE schedules SET revision = revision + 1, definition = ?, due_at = ?, state = 'active', source_op = ? WHERE id = ?")
        .run(JSON.stringify(next), nextDue(next.schedule, store.now()), sourceOp, id)
      options.changed()
      return true
    })
  }
  function queue(): void {
    transaction(store.db, () => {
      for (const row of list()) {
        if (row.state !== 'active' || row.dueAt > store.now()) continue
        store.db.prepare("INSERT OR IGNORE INTO schedule_occurrences VALUES (?, ?, ?, ?, 'queued')")
          .run(row.id, row.revision, row.dueAt, `wake:${row.id}:${row.revision}:${row.dueAt}`)
      }
    })
  }
  function admit(opId: string): boolean {
    return transaction(store.db, () => {
      const raw = store.db.prepare('SELECT * FROM schedule_occurrences WHERE op_id = ?').get(opId)
      if (raw === undefined) return false
      const occurrence = decodeOccurrence(raw)
      const row = valid(occurrence)
      if (occurrence.state !== 'queued' || row === undefined) return false
      store.db.prepare("INSERT INTO inbox (op_id, kind, text, data, at, state) VALUES (?, 'wake', ?, ?, ?, 'accepted')")
        .run(opId, row.definition.unlessReply === undefined ? row.definition.prompt : `${row.definition.prompt}\nWatched conversation: ${JSON.stringify(row.definition.unlessReply)}`, JSON.stringify({ scheduleId: row.id, revision: row.revision, dueAt: occurrence.due_at, unlessReply: row.definition.unlessReply }), store.now())
      store.db.prepare("UPDATE schedule_occurrences SET state = 'admitted' WHERE op_id = ?").run(opId)
      return true
    })
  }
  /** Call synchronously at the router's admission boundary, before resetting/submitting a wake. */
  function start(opId: string, persistRun: () => void = () => {}): boolean {
    const commit = () => {
      const raw = store.db.prepare('SELECT * FROM schedule_occurrences WHERE op_id = ?').get(opId)
      if (raw === undefined) return false
      const occurrence = decodeOccurrence(raw)
      const row = valid(occurrence)
      if (occurrence.state !== 'admitted' || row === undefined) return false
      persistRun()
      store.db.prepare("UPDATE schedule_occurrences SET state = 'started' WHERE op_id = ?").run(opId)
      if (row.definition.schedule._tag === 'once') {
        revokeGrant(store, 'schedule', row.id, 'delete')
        store.db.prepare("UPDATE schedules SET state = 'deleted', revision = revision + 1 WHERE id = ?").run(row.id)
      } else {
        store.db.prepare('UPDATE schedules SET due_at = ? WHERE id = ?').run(nextDue(row.definition.schedule, store.now()), row.id)
      }
      return true
    }
    return store.db.isTransaction ? commit() : transaction(store.db, commit)
  }
  function observe(reply: Reply, owner: string): void {
    for (const row of list()) {
      const watch = row.definition.unlessReply
      if (watch !== undefined && matchesReply(watch, reply, owner)) cancel(row.id, row.revision)
    }
  }
  async function tick(): Promise<void> {
    queue()
    for (const occurrence of occurrences()) {
      if (occurrence.state !== 'queued') continue
      const row = valid(occurrence)
      if (row === undefined) continue
      if (row.definition.unlessReply !== undefined) {
        const refreshed = await options.replies(row.definition.unlessReply)
        for (const reply of refreshed.messages) observe(reply, refreshed.owner)
      }
      if (admit(occurrence.op_id)) options.changed()
    }
  }
  function watchReply(input: { readonly opId: string; readonly watch: Omit<ReplyWatch, 'from'>; readonly hours: NotificationHours }) {
    if (!mayAuthorize(authorityOf(store))) return undefined
    const at = menuDeadline(store.now(), input.hours)
    const result = create({ key: input.opId, sourceOp: input.opId, authority: { _tag: 'menu' }, definition: {
      what: 'Tell you if nobody replies', prompt: NUDGE_PROMPT, schedule: { _tag: 'once', at }, deliver: 'now', unlessReply: { ...input.watch, from: 'others' },
    } })
    return result
  }
  function page() {
    return {
      page: { schedules: list().map((row) => {
        const active = row.state === 'active' && mayAuthorize(authorityOf(store)) && liveGrant(store, 'schedule', row.id) !== undefined
        return { id: ScheduleId.make(row.id), what: row.definition.what, when: describeWhen(row.definition), deliver: row.definition.deliver,
          state: active ? 'active' as const : 'paused' as const, ...(active ? { nextAt: row.dueAt } : {}) }
      }) },
      revisions: list().map((row) => ({ id: ScheduleId.make(row.id), revision: Revision.make(row.revision) })),
    }
  }
  return { get, list, occurrences, create, cancel, resume, edit, queue, admit, start, observe, tick, watchReply, page }
}
export type Scheduler = ReturnType<typeof createScheduler>
export function describeWhen(definition: Definition): string {
  switch (definition.schedule._tag) {
    case 'once': return `${definition.unlessReply === undefined ? 'At' : 'Until'} ${new Date(definition.schedule.at).toISOString()}`
    case 'interval': return `Every ${definition.schedule.everyMs / 60_000} minutes`
    case 'wallClock': return `${definition.schedule.time} (${definition.schedule.timeZone})`
  }
}
export class ScheduleService extends Context.Service<ScheduleService, Scheduler>()('juno/agent/Schedule') {
  static layer(options: SchedulerOptions) { return Layer.sync(ScheduleService, () => createScheduler(options)) }
}
/** Scoped by the caller; a failed refresh leaves the occurrence queued for the next tick. */
export const runScheduler = (scheduler: Scheduler) => Effect.gen(function* () {
  while (true) {
    yield* Effect.tryPromise(() => scheduler.tick()).pipe(Effect.catch(() => Effect.void))
    yield* Effect.sleep('1 second')
  }
})
