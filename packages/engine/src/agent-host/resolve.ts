import { Effect, Schema } from 'effect'
import { AgentHostError, type HostDispatch } from '@juno/agent-contract'
import { UndoCommand } from '@juno/contract'
import { StoreWriter, transaction } from '@juno/store'
import { resolveTopic, restoreTopic } from '../topicActions'
import { Workspace } from '../workspace'
import { MarkWorker } from '../markWorker'
import * as approvals from './approvals'

const Args = Schema.Struct({ topicIds: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(20)) })
const rejected = (message: string) => new AgentHostError({ reason: 'rejected', message })

/** Keep the workspace and the transaction fixed across the whole batch and its receipt. */
const inWorkspace = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const workspace = yield* Workspace
  const open = yield* workspace.current
  if (open === undefined) return yield* new AgentHostError({ reason: 'signedOut', message: 'Juno is signed out of Slack.' })
  return yield* transaction(effect).pipe(Effect.provide(open.context),
    Effect.provideService(Workspace, { ...workspace, current: Effect.succeed(open) }),
    Effect.catchTag('SqlError', Effect.die))
})

export const resolve = (dispatch: typeof HostDispatch.Type) => Effect.gen(function* () {
  const { payload } = dispatch
  const args = yield* Schema.decodeUnknownEffect(Args)(payload.args).pipe(Effect.mapError(() => rejected('Expected one to twenty topic ids.')))
  if (payload.tool !== 'topics_resolve' || payload.connection_id !== 'slack' ||
    JSON.stringify(args.topicIds) !== JSON.stringify(payload.destination_ids) || new Set(args.topicIds).size !== args.topicIds.length) {
    return yield* rejected('The resolve targets do not match the approved action.')
  }
  const queued = yield* inWorkspace(Effect.gen(function* () {
    const sql = yield* StoreWriter
    const [existing] = yield* sql<{ action_id: string; authorization_id: string; attempt_id: string; digest: string }>`SELECT * FROM agent_resolves
      WHERE action_id = ${dispatch.actionId} OR authorization_id = ${dispatch.authorizationId} OR attempt_id = ${dispatch.attemptId}`
    if (existing !== undefined) {
      if (existing.action_id !== dispatch.actionId || existing.authorization_id !== dispatch.authorizationId || existing.attempt_id !== dispatch.attemptId || existing.digest !== dispatch.digest) return yield* rejected('This resolve identity was already used.')
      return false
    }
    yield* approvals.take(dispatch.actionId, dispatch.digest, dispatch.authorizationId)
    const undo = []
    let queued = false
    for (const id of args.topicIds) {
      const result = yield* resolveTopic(id)
      if (result.result.undo !== undefined) undo.push(result.result.undo)
      queued ||= result.queued
    }
    yield* sql`INSERT INTO agent_resolves (action_id, authorization_id, attempt_id, digest, undo)
      VALUES (${dispatch.actionId}, ${dispatch.authorizationId}, ${dispatch.attemptId}, ${dispatch.digest}, ${JSON.stringify(undo)})`
    return queued
  })).pipe(Effect.mapError(error => error._tag === 'AgentHostError' ? error : rejected('A topic is no longer available.')))
  if (queued) yield* (yield* MarkWorker).wake
  return { _tag: 'done' as const, attemptId: dispatch.attemptId, receipt: { actionId: dispatch.actionId } }
})

export const undoResolve = (actionId: string) => Effect.gen(function* () {
  const queued = yield* inWorkspace(Effect.gen(function* () {
    const sql = yield* StoreWriter
    const [row] = yield* sql<{ undo: string; undone: number }>`SELECT undo, undone FROM agent_resolves WHERE action_id = ${actionId}`
    if (row === undefined) return yield* rejected('The resolve result is unavailable.')
    if (row.undone) return false
    const commands = Schema.decodeUnknownSync(Schema.Array(UndoCommand))(JSON.parse(row.undo))
    let queued = false
    for (const command of commands) {
      if (command._tag !== 'topics.restore') return yield* rejected('Invalid resolve Undo.')
      const result = yield* restoreTopic(command.id, command.overlay, command.unreadFrom)
      queued ||= result.queued
    }
    yield* sql`UPDATE agent_resolves SET undone = 1 WHERE action_id = ${actionId}`
    return queued
  })).pipe(Effect.mapError(error => error._tag === 'AgentHostError' ? error : rejected('A topic is no longer available.')))
  if (queued) yield* (yield* MarkWorker).wake
})
