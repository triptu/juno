import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { toCard } from '@juno/agent-cards'
import { Card, JobId, ProposedMessageId, QuestionOptionId } from '../chat'
import { CardIdentity, ChildApproval } from './identity'
import { Accepted, AgentCommandError, operation } from './common'

/** Compile-time bridge checks the pure projection without reversing the package graph. */
export const projectCard: (record: Parameters<typeof toCard>[0], now: number) => Card = toCard
export const CardChoice = Schema.Union([
  Schema.TaggedStruct('send', {}), Schema.TaggedStruct('resolve', {}), Schema.TaggedStruct('start', {}),
  Schema.TaggedStruct('apply', {}), Schema.TaggedStruct('connect', {}), Schema.TaggedStruct('keep', {}),
  Schema.TaggedStruct('pause', {}), Schema.TaggedStruct('deleteSchedule', {}), Schema.TaggedStruct('allowBudget', {}),
  Schema.TaggedStruct('remove', { alsoRemoveReply: Schema.Boolean }),
  Schema.TaggedStruct('answer', { answer: Schema.Union([
    Schema.TaggedStruct('option', { optionId: QuestionOptionId }), Schema.TaggedStruct('text', { text: Schema.String }),
  ]) }),
  Schema.TaggedStruct('provider', { provider: Schema.Literals(['openrouter', 'codex']) }),
])
/** Choice data that changes executable args must first be materialized by prepare.
 * The response binds the new stored revision and digest; approve never accepts new args. */
export const cardsPrepare = Rpc.make('agent.cards.prepare', {
  payload: { ...operation, identity: CardIdentity, choice: CardChoice },
  success: Schema.Struct({ card: Card, identity: CardIdentity, children: Schema.Array(ChildApproval) }), error: AgentCommandError,
})
export const cardsApprove = Rpc.make('agent.cards.approve', {
  payload: { ...operation, identity: CardIdentity, children: Schema.NonEmptyArray(ChildApproval) }, success: Accepted, error: AgentCommandError,
})
export const cardsDismiss = Rpc.make('agent.cards.dismiss', {
  payload: { ...operation, identity: CardIdentity }, success: Accepted, error: AgentCommandError,
})
export const cardsEditMessage = Rpc.make('agent.cards.editMessage', {
  payload: { ...operation, identity: CardIdentity, messageId: ProposedMessageId, text: Schema.String },
  success: Schema.Struct({ card: Card, identity: CardIdentity }), error: AgentCommandError,
})
export const cardsUndo = Rpc.make('agent.cards.undo', { payload: { ...operation, identity: CardIdentity }, success: Accepted, error: AgentCommandError })
export const jobStop = Rpc.make('agent.jobs.stop', { payload: { ...operation, jobId: JobId }, success: Accepted, error: AgentCommandError })
export const CardRpcs = RpcGroup.make(cardsPrepare, cardsApprove, cardsDismiss, cardsEditMessage, cardsUndo, jobStop)
