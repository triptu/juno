import { Schema } from 'effect'
import { CardPayload } from '@juno/agent-cards'
import type { Actions } from '../actions'
import type { Job } from '../jobs/jobs'
import type { McpManagerApi } from '../mcp/manager'
import { changeCard } from '../mcp/actions'
import { authorityOf } from '../grants/grants'
import { mayAuthorize } from '../policy/policy'
import { uuidv7 } from '../store/store'
import { sessionOf } from './protocol'

/**
 * Stops a T3 Code session through an interrupt Change card and the durable dispatcher.
 *
 * - `click` is the Task card's Stop, an owner click: it approves one interrupt, with no
 *   second click. A Stop after an earlier stop failed, expired or was dismissed is a new
 *   click and gets a new card; an interrupt still on its way is not sent twice.
 * - Without a click (a removal made Juno stop watching) the card is only proposed, with a
 *   line saying why, and waits for the owner's Apply.
 * - While paused or off nothing is approved: Pause also stops every job, and an interrupt
 *   queued then would reach T3 Code on Resume with no click.
 *
 * Resolves true only when the interrupt is confirmed. It never throws: a stop that
 * cannot be built leaves the job running.
 */
export async function stopSession(manager: McpManagerApi, actions: Actions, job: Job, click: string | undefined): Promise<boolean> {
  try {
    const session = sessionOf(job.task)
    if (session.epoch !== manager.stored('t3').epoch) return false
    const prefix = `t3-stop:${job.id}`
    const status = (id: string) => {
      const view = actions.views().find((v) => v.card.id === id)
      return { binding: view?.binding, status: view !== undefined && 'status' in view.card ? view.card.status._tag : undefined }
    }
    const newest = manager.store.db.prepare('SELECT id FROM cards WHERE call_id = ? OR call_id LIKE ? ORDER BY created_at DESC, id DESC LIMIT 1').get(prefix, `${prefix}:%`)
    const latest = typeof newest?.id === 'string' ? { id: newest.id, ...status(newest.id) } : undefined
    if (latest?.status === 'done') return true
    if (latest?.status === 'working') return false
    if (click !== undefined && !mayAuthorize(authorityOf(manager.store))) return false
    let id = latest?.binding !== undefined ? latest.id : undefined
    if (id === undefined) {
      const payload = await changeCard(manager, 't3', 't3_thread_interrupt', { threadId: session.threadId })
      if (payload._tag !== 'change') return false
      id = actions.propose({ runId: job.runId, callId: `${prefix}:${click ?? uuidv7(manager.store.now())}`, payload: Schema.decodeUnknownSync(CardPayload)({
        ...payload, target: job.title, ...(click === undefined ? { caption: 'Juno stopped watching this session after a removal.' } : {}),
        action: { ...payload.action, payload: { ...payload.action.payload, destination_ids: [session.threadId] } },
      }) })
    }
    if (click === undefined) return false
    const { binding } = status(id)
    // Checked again after the await above: a Pause may have come in while the card was built.
    if (binding && mayAuthorize(authorityOf(manager.store))) actions.approve(click, binding.identity, binding.children)
    await actions.idle()
    return status(id).status === 'done'
  } catch {
    return false
  }
}
