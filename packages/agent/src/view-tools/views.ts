/** Local sidebar settings: the owner's words apply now; untrusted runs propose Apply. */
import { Schema } from 'effect'
import { HostViewDraft, HostViewUndo, type CardBinding } from '@juno/agent-contract'
import { AccountId, CardPayload, digestJson, expandChildActions } from '@juno/agent-cards'
import type { Actions, CardView, Executor, Proposal } from '../actions'
import { bindingOf, cardRow, intentOf, memoryGen, payloadOf, recordOutcome } from '../actions/cards'
import { toolDecision } from '../policy/policy'
import { defineTool, type ToolRun } from '../request/tool'
import { authorize, recordAttempt, recordReceipt } from '../store/ledger'
import { uuidv7, type Store } from '../store/store'
import type { ViewHost } from './host'

const TOOL = 'juno_views'
const Change = Schema.Union([
  Schema.TaggedStruct('create', { view: HostViewDraft }),
  Schema.TaggedStruct('update', { id: Schema.String, view: HostViewDraft }),
  Schema.TaggedStruct('delete', { id: Schema.String }),
])
const Input = Schema.Union([Schema.TaggedStruct('list', {}), Change])
const HASH = digestJson({ tool: TOOL, version: 1 })
const Row = Schema.Struct({ account_id: AccountId, undo: Schema.String, undone: Schema.Int })
const decode = Schema.decodeUnknownSync

export function createViewSettings(context: {
  readonly store: Store
  readonly host: ViewHost
  readonly current: () => Promise<ToolRun | undefined>
  readonly actions: () => Actions
}) {
  const { store, host } = context
  const saved = (id: string) => {
    const row = store.db.prepare('SELECT account_id, undo, undone FROM view_changes WHERE card_id = ?').get(id)
    return row === undefined ? undefined : decode(Row)(row)
  }
  const executor: Executor = {
    tool: TOOL, tier: 1, deduped: false,
    check: async (payload) => payload.schema_hash !== HASH ? 'schemaChanged' : host.account() === undefined ? 'wait' : host.account() !== payload.account_id ? 'accountChanged' : 'valid',
    run: async (call) => {
      const change = decode(Change)(call.payload.args)
      const result = change._tag === 'delete' ? await host.delete(call.payload.account_id, change.id) :
        await host.save(call.payload.account_id, change.view, change._tag === 'update' ? change.id : undefined)
      store.db.prepare('INSERT INTO view_changes (card_id, account_id, undo) VALUES (?, ?, ?)')
        .run(call.cardId, call.payload.account_id, JSON.stringify(result.undo))
      return { _tag: 'done', receipt: { viewId: result.id } }
    },
  }
  const proposal = (change: typeof Change.Type, account: typeof AccountId.Type, because: boolean): CardPayload => decode(CardPayload)({
    _tag: 'change', server: 'Juno', target: change._tag === 'delete' ? `View ${change.id}` : `${change.view.name} view`,
    ...(because ? { because: 'I read content from Slack or another source in this reply.' } : {}),
    action: { id: uuidv7(store.now()), rev: 1, tier: 1, deduped: false, source: memoryGen(store), payload: {
      connection_id: 'juno', account_id: account, destination_ids: change._tag === 'create' ? [] : [change.id],
      tool: TOOL, schema_hash: HASH, args: change, preconditions: {}, ops: [],
    } },
  })
  const tool = defineTool<typeof Input.Type>({
    name: TOOL, description: 'List, create, replace or delete local Juno sidebar views. Resolve channel names with slack_channels first. These settings do not write to Slack. Owner requests apply immediately with Undo; after reading Slack content, propose a Change card.',
    parameters: { type: 'object', properties: {
      _tag: { enum: ['list', 'create', 'update', 'delete'] }, id: { type: 'string' },
      view: { type: 'object', properties: { name: { type: 'string' }, icon: { type: 'string', description: 'Optional icon, for example robot, bell, star or code.' },
        channels: { type: 'array', items: { type: 'string' } }, keepOutOfAll: { type: 'boolean' } }, required: ['name', 'channels', 'keepOutOfAll'], additionalProperties: false },
    }, required: ['_tag'], additionalProperties: false },
    replay: 'unsafe', status: () => 'Updating views',
    run: async (input, call) => {
      const change = decode(Input)(input)
      const account = host.account()
      if (account === undefined) return { text: 'Juno is signed out of Slack.', isError: true }
      if (change._tag === 'list') return { text: JSON.stringify(await host.list(account)) }
      const run = await context.current()
      if (run === undefined) return { text: 'No active run.', isError: true }
      const decision = toolDecision('viewsSet', run)
      if (decision._tag === 'refused') return { text: 'Only the owner can change views.', isError: true }
      const proposed: Proposal = { runId: run.runId, callId: call.callId, payload: proposal(change, account, decision._tag === 'card') }
      const actions = context.actions()
      const id = actions.propose(proposed)
      if (decision._tag === 'card') return { text: `Proposed view change ${id}. It waits for Apply.` }
      const row = cardRow(store, id)!
      const payload = payloadOf(store, row)
      const child = expandChildActions(payload)[0]!
      const intent = intentOf(store, child.id, child.rev)!
      if (store.db.prepare('SELECT 1 FROM authorizations WHERE intent_id = ?').get(intent.id) !== undefined) return { text: 'This view change was already attempted.', isError: true }
      // Authorize before the host call and retain the journal position, as for other local effects.
      const auth = authorize(store, { intentId: intent.id, originOp: run.opId, position: run.position })
      if (auth._tag !== 'authorized') return { text: 'Views could not be changed while Juno is paused or unavailable.', isError: true }
      const attempt = recordAttempt(store, auth.id)
      if (attempt === undefined) return { text: 'The view change was cancelled.', isError: true }
      try {
        const result = await executor.run({ actionId: child.id, authorizationId: auth.id, attemptId: attempt, digest: intent.digest,
          payload: child.payload, cardId: id, opId: run.opId })
        if (result._tag === 'done') {
          recordReceipt(store, attempt, result.receipt)
          recordOutcome(store, id, 'done', 'Views changed')
          actions.changed()
          return { text: 'Views changed. The chat shows Undo.' }
        }
      } catch {
        store.db.prepare("UPDATE authorizations SET outcome = 'unknown' WHERE id = ?").run(auth.id)
      }
      actions.changed()
      return { text: 'The view change could not be confirmed.', isError: true }
    },
  })
  const decorate = (view: CardView): CardView => {
    const row = saved(view.card.id)
    if (row === undefined || view.card._tag !== 'change') return view
    const card = cardRow(store, view.card.id)!
    return { ...view, binding: bindingOf(card, payloadOf(store, card)), card: { ...view.card,
      status: row.undone === 1 ? { _tag: 'done', line: 'Undone' } : { _tag: 'done', line: 'Applied', undo: true } } }
  }
  const undo = async (identity: typeof CardBinding.Type['identity']): Promise<boolean> => {
    const card = cardRow(store, identity.cardId)
    if (card === undefined) return false
    const binding = bindingOf(card, payloadOf(store, card)).identity
    if (binding.revision !== identity.revision || binding.digest !== identity.digest) return false
    const row = saved(card.id)
    if (row === undefined) return false
    if (row.undone === 1) return true
    try {
      await host.undo(row.account_id, decode(HostViewUndo)(JSON.parse(row.undo)))
    } catch {
      return false
    }
    store.db.prepare('UPDATE view_changes SET undone = 1 WHERE card_id = ?').run(card.id)
    context.actions().changed()
    return true
  }
  return { tool, executor, decorate, undo }
}
