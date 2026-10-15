/**
 * The removal Juno proposes (plan v3 §4.5, §12, W3; SPEC 13.3, 13.8): the
 * `remove_messages` tool and the `remove` card's executor. The owner's own
 * Remove is the local sheet (`Redaction.remove`), which needs no run.
 *
 * The model names owner messages by their handles (`n12`); the trusted side
 * finds them and builds the card: each message's first line and time, and
 * "Also remove Juno's reply" when Juno's reply follows the first one. A
 * click runs the removal once, with the owner's choice
 * (`args.choice.alsoRemoveReply`). Removing is idempotent, so the child is
 * deduplicated, and reconcile finds a removal by its op.
 */
import { Schema } from 'effect'
import {
  AccountId, ActionId, CardPayload, ConnectionId, Revision, SourceGeneration, digestJson,
  type ChildAction, type ExecutableIdentity,
} from '@juno/agent-cards'
import { memoryGen, type Proposal } from '../actions/cards'
import type { Executor } from '../actions/executor'
import { defineTool, type JunoTool, type ToolRun } from '../request/tool'
import { ownerOpOf } from '../router/input'
import { uuidv7, type Store } from '../store/store'
import type { Redaction } from './redaction'
import { replyOf, type ArchiveRow } from './scope'

export const REMOVE_TOOL = 'remove_messages'
export const REMOVE_SCHEMA = digestJson({ tool: REMOVE_TOOL, args: { messageIds: 'number[]' } })

const PREVIEW_CHARS = 120
const firstLine = (text: string) => {
  const line = text.trim().split('\n', 1)[0] ?? ''
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line
}

/** The op a removal by a remove card runs under. */
export const cardRemovalOp = (actionId: string) => `card:${actionId}`

/** An owner message the model can name: its archive id, words and time. */
function ownerMessage(store: Store, handle: string): { readonly id: number; readonly text: string; readonly at: number } | undefined {
  const opId = ownerOpOf(store, handle)
  if (opId === undefined) return undefined
  const row = store.db
    .prepare(
      `SELECT min(messages.id) AS id, inbox.text, inbox.at FROM inbox JOIN messages ON messages.origin_op = inbox.op_id AND messages.kind = 'user'
       WHERE inbox.op_id = ? AND messages.redacted_gen IS NULL`,
    )
    .get(opId) as { id: number | null; text: string; at: number } | undefined
  return row?.id == null ? undefined : { id: row.id, text: row.text, at: row.at }
}

/** The `remove` card for owner messages. Undefined when a handle names no owner message still there. */
export function removeCard(store: Store, handles: ReadonlyArray<string>): CardPayload | undefined {
  const found = handles.map((handle) => ownerMessage(store, handle))
  if (found.length === 0 || found.some((m) => m === undefined)) return undefined
  const messages = [...new Map(found.map((m) => [m!.id, m!])).values()].sort((a, b) => a.id - b.id)
  const archive = store.db
    .prepare("SELECT id, kind, origin_op AS originOp, incarnation || '/' || entry_id AS entry FROM messages WHERE id >= ? AND redacted_gen IS NULL ORDER BY id")
    .all(messages[0]!.id) as unknown as ReadonlyArray<ArchiveRow>
  const reply = replyOf(archive, messages[0]!.id)
  const payload: ExecutableIdentity = {
    connection_id: ConnectionId.make('juno'), account_id: AccountId.make('owner'), destination_ids: [], tool: REMOVE_TOOL,
    schema_hash: REMOVE_SCHEMA as ExecutableIdentity['schema_hash'], args: { messageIds: messages.map((m) => m.id) }, preconditions: {}, ops: [],
  }
  const action: ChildAction = { id: ActionId.make(uuidv7(store.now())), rev: Revision.make(1), payload, tier: 3, deduped: true, source: SourceGeneration.make(memoryGen(store)) }
  return Schema.decodeUnknownSync(CardPayload)({
    _tag: 'remove',
    messages: messages.map((m) => ({ messageId: String(m.id), preview: firstLine(m.text), at: m.at })),
    ...(reply === undefined ? {} : { offerReply: String(reply) }),
    action: JSON.parse(JSON.stringify(action)),
  })
}

/** `remove_messages`: proposes a Remove card. Nothing is removed until the owner clicks Remove. */
export function removeTool(context: { readonly store: Store; readonly current: () => Promise<ToolRun | undefined>; readonly propose: (proposal: Proposal) => string }): JunoTool {
  return defineTool<{ readonly messages: ReadonlyArray<string> }>({
    name: REMOVE_TOOL,
    description:
      'Propose removing the owner\'s own messages from Juno: the message, what Juno learned from it, and pending actions that saw it. ' +
      'The owner sees a Remove card and removes with one click; nothing is removed until then. Use when the owner asks you to forget something they said. ' +
      'Name each message by its id, n<number>.',
    parameters: {
      type: 'object',
      properties: { messages: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', description: 'An owner message id, n<number>' } } },
      required: ['messages'],
      additionalProperties: false,
    },
    replay: 'safe',
    status: () => 'Preparing a removal',
    run: async ({ messages }, call) => {
      const run = await context.current()
      if (run === undefined) return { text: 'No card was proposed.', isError: true }
      const payload = removeCard(context.store, messages)
      if (payload === undefined) return { text: 'Name the owner\'s own messages by their ids, n<number>. No card was proposed.', isError: true }
      const id = context.propose({ runId: run.runId, callId: call.callId, payload })
      return { text: `Proposed card ${id}. Nothing is removed until the owner clicks Remove.` }
    },
  })
}

/** The `remove` card's child: the removal itself. */
export function removeExecutor(redaction: Pick<Redaction, 'remove'>, store: Store): Executor {
  return {
    tool: REMOVE_TOOL,
    tier: 3,
    deduped: true,
    check: async (payload) => (payload.schema_hash === REMOVE_SCHEMA ? 'valid' : 'schemaChanged'),
    run: async (call) => {
      const args = call.payload.args as { messageIds: number[]; choice?: { alsoRemoveReply?: boolean } }
      const result = await redaction.remove({ opId: cardRemovalOp(call.actionId), messageIds: args.messageIds, alsoRemoveReply: args.choice?.alsoRemoveReply === true })
      if (result._tag === 'notFound') return { _tag: 'failed', detail: 'The messages are not in the chat.' }
      return { _tag: 'done', receipt: { gen: result.gen, messages: result.messages } }
    },
    reconcile: async (call) => {
      const row = store.db.prepare('SELECT gen, messages FROM removals WHERE op_id = ?').get(cardRemovalOp(call.actionId)) as { gen: number; messages: string } | undefined
      return row === undefined ? { _tag: 'unknown' } : { _tag: 'found', receipt: { gen: row.gen, messages: (JSON.parse(row.messages) as number[]).length } }
    },
  }
}
