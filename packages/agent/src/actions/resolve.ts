import type { CardBinding } from '@juno/agent-contract'
import { Schema } from 'effect'
import { defineTool } from '../request/tool'
import type { Store } from '../store/store'
import { bindingOf, cardRow, payloadOf, type CardView } from './cards'
import type { ActionHost } from './host'
import { resolveCard, type ProposeContext } from './proposals'

const Input = Schema.Struct({ topicIds: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(20)) })

export function resolveTool(context: ProposeContext & { readonly host: ActionHost }) {
  return defineTool<typeof Input.Type>({
    name: 'topics_resolve',
    description: 'Propose resolving one to twenty topics in Juno. Always shows a Resolve card and waits for the owner to click. Resolving hides the topics and marks them read, with Undo. It does not unfollow threads or send messages to Slack.',
    parameters: { type: 'object', properties: { topicIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 } }, required: ['topicIds'], additionalProperties: false },
    replay: 'safe', status: () => 'Preparing to resolve topics',
    run: async (input, call) => {
      const { topicIds } = Schema.decodeUnknownSync(Input)(input)
      const run = await context.current()
      const account = context.host.account()
      if (run === undefined || account === undefined) return { text: 'No resolve card can be proposed now.', isError: true }
      const topics = []
      for (const id of new Set(topicIds)) {
        try { topics.push((await context.host.topic(id)).topic) }
        catch { return { text: `Juno could not find ${id}.`, isError: true } }
      }
      if (context.host.account() !== account) return { text: 'The Slack account changed.', isError: true }
      const id = context.propose({ runId: run.runId, callId: call.callId, payload: resolveCard(context.store, { account, topics }) })
      return { text: `Proposed Resolve card ${id}. Nothing is resolved until the owner clicks Resolve.` }
    },
  })
}

export function resolveUndo(store: Store, host: ActionHost, changed: () => void) {
  const decorate = (view: CardView): CardView => {
    if (view.card._tag !== 'resolve' || view.card.status._tag !== 'done' || host.undoResolve === undefined) return view
    const row = cardRow(store, view.card.id)!
    const undone = store.db.prepare('SELECT 1 FROM resolve_undos WHERE card_id = ?').get(row.id) !== undefined
    return { ...view, binding: bindingOf(row, payloadOf(store, row)), card: { ...view.card,
      status: undone ? { _tag: 'done', line: 'Undone' } : { ...view.card.status, undo: true } } }
  }
  const undo = async (identity: typeof CardBinding.Type['identity']): Promise<boolean> => {
    const row = cardRow(store, identity.cardId)
    if (row === undefined || host.undoResolve === undefined) return false
    const payload = payloadOf(store, row)
    if (payload._tag !== 'resolve') return false
    const binding = bindingOf(row, payload)
    if (binding.identity.revision !== identity.revision || binding.identity.digest !== identity.digest) return false
    if (store.db.prepare('SELECT 1 FROM resolve_undos WHERE card_id = ?').get(row.id) !== undefined) return true
    const done = store.db.prepare(`SELECT 1 FROM intents JOIN authorizations ON authorizations.intent_id = intents.id
      JOIN attempts ON attempts.authorization_id = authorizations.id JOIN receipts ON receipts.attempt_id = attempts.id
      WHERE intents.action_id = ?`).get(payload.action.id)
    if (done === undefined) return false
    try { await host.undoResolve(payload.action.payload.account_id, payload.action.id) }
    catch { return false }
    store.db.prepare('INSERT OR IGNORE INTO resolve_undos (card_id) VALUES (?)').run(row.id)
    changed()
    return true
  }
  return { decorate, undo }
}
