/**
 * Juno's memory of the owner and its proactive asks (SPEC 13.6, 13.8).
 *
 * - `agent.docs.page` streams the docs and the recent changes, with each
 *   entry's revision beside it. Add, edit and delete are the owner's, on the
 *   trusted side, with no inbox op; an edit or delete names the revision the
 *   page showed and answers `stale` when it moved.
 * - `agent.docs.undo` is the chat note's Undo: it puts back the changes of
 *   one run or learning pass that nothing changed since.
 * - `agent.docs.relationship` is the owner correcting who a person is to
 *   them; `agent.docs.deletePerson` deletes a person's file. Both are the
 *   owner's, on the trusted side, like an edit.
 * - `agent.asks.list` streams the asks, open ones and their passes, for the
 *   chat and Home. `agent.asks.answer` is Start, Not now or Stop.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { Revision } from '@juno/agent-cards'
import * as C from '../chat'
import { Accepted, AgentCommandError, operation } from './common'

export const docsPage = Rpc.make('agent.docs.page', {
  success: Schema.Struct({ page: C.MemoryDocsPage, revisions: Schema.Array(Schema.Struct({ id: C.MemoryEntryId, revision: Revision })) }),
  stream: true,
})
export const docsAdd = Rpc.make('agent.docs.add', {
  payload: { ...operation, doc: C.MemoryDoc, text: Schema.String, person: Schema.optionalKey(C.MemoryPersonId), section: Schema.optionalKey(C.MemorySection) },
  success: Accepted, error: AgentCommandError,
})
export const docsEdit = Rpc.make('agent.docs.edit', { payload: { ...operation, id: C.MemoryEntryId, revision: Revision, text: Schema.String }, success: Accepted, error: AgentCommandError })
export const docsDelete = Rpc.make('agent.docs.delete', { payload: { ...operation, id: C.MemoryEntryId, revision: Revision }, success: Accepted, error: AgentCommandError })
export const docsUndo = Rpc.make('agent.docs.undo', { payload: { ...operation, run: Schema.String }, success: Accepted, error: AgentCommandError })
export const docsRelationship = Rpc.make('agent.docs.relationship', {
  payload: { ...operation, person: C.MemoryPersonId, revision: Schema.Int, relationship: Schema.NullOr(C.PersonRelationship) },
  success: Accepted, error: AgentCommandError,
})
export const docsDeletePerson = Rpc.make('agent.docs.deletePerson', { payload: { ...operation, person: C.MemoryPersonId }, success: Accepted, error: AgentCommandError })
export const DocsRpcs = RpcGroup.make(docsPage, docsAdd, docsEdit, docsDelete, docsUndo, docsRelationship, docsDeletePerson)

export const asksList = Rpc.make('agent.asks.list', { success: Schema.Struct({ asks: Schema.Array(C.ProactiveAsk) }), stream: true })
export const asksAnswer = Rpc.make('agent.asks.answer', { payload: { ...operation, id: C.AskId, answer: C.AskAnswer }, success: Accepted, error: AgentCommandError })
export const AskRpcs = RpcGroup.make(asksList, asksAnswer)
