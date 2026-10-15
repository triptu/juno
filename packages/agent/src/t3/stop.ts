import { Schema } from 'effect'
import { CardPayload } from '@juno/agent-cards'
import type { Actions } from '../actions'
import type { Job } from '../jobs/jobs'
import type { McpManagerApi } from '../mcp/manager'
import { changeCard } from '../mcp/actions'
import { authorityOf } from '../grants/grants'
import { mayAuthorize } from '../policy/policy'
import { sessionOf } from './protocol'

/**
 * The Task card's Stop is already an owner click; reuse the durable dispatcher.
 * While paused or off nothing is approved: Pause also stops every job, and an
 * interrupt queued then would reach T3 Code on Resume with no click.
 */
export async function stopSession(manager: McpManagerApi, actions: Actions, job: Job): Promise<boolean> {
  const session = sessionOf(job.task)
  if (session.epoch !== manager.stored('t3').epoch || !mayAuthorize(authorityOf(manager.store))) return false
  const callId = `t3-stop:${job.id}`
  const existing = manager.store.db.prepare('SELECT id FROM cards WHERE call_id = ?').get(callId)
  let id: string
  if (typeof existing?.id === 'string') id = existing.id
  else {
    const payload = await changeCard(manager, 't3', 't3_thread_interrupt', { threadId: session.threadId })
    if (payload._tag !== 'change') return false
    id = actions.propose({ runId: job.runId, callId, payload: Schema.decodeUnknownSync(CardPayload)({
      ...payload, target: job.title, action: { ...payload.action, payload: { ...payload.action.payload, destination_ids: [session.threadId] } },
    }) })
  }
  const binding = actions.views().find((view) => view.card.id === id)?.binding
  // Checked again after the await above: a Pause may have come in while the card was built.
  if (binding && mayAuthorize(authorityOf(manager.store))) actions.approve(callId, binding.identity, binding.children)
  await actions.idle()
  const card = actions.views().find((view) => view.card.id === id)?.card
  return card !== undefined && 'status' in card && card.status._tag === 'done'
}
