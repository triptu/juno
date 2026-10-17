/**
 * The bridge from the inbox to pi-durable (plan v3 §3; spec `resetBridge`,
 * `submit`, `markSubmitted`, `bridgeReplay`).
 *
 * One op at a time, while the conversation is idle: reset, then submit with
 * `requestId = op_id`, then commit `submitted` with the incarnation and the
 * submission id. A crash anywhere in between leaves the op `accepted`; the
 * next delivery finds the submission pi already holds for the op and only
 * commits `submitted`, so the journal holds each op once (spec `bridgeDedupe`).
 * It never resets again once pi has the op: a reset placed during a resumed
 * run would end that run. A crash between the reset and the submit leaves an
 * extra reset entry, which is harmless while idle.
 *
 * A steer joins the running run and is never preceded by a reset. `text`
 * gives what the model reads for the op (the router wraps owner input and
 * adds a message's images); it is read only when pi does not hold the op yet.
 */
import { crashPoint } from '../runtime/crash'
import type { InputContent, Journal } from '../runtime/journal'
import type { Store } from '../store/store'
import { markSubmitted, type InboxOp } from './inbox'

export async function deliver(
  store: Store,
  journal: Journal,
  op: InboxOp,
  options: { readonly steer: boolean; readonly text?: () => InputContent },
): Promise<string> {
  let submissionId = await journal.submissionFor(op.opId)
  if (submissionId === undefined) {
    if (!options.steer) {
      await journal.reset()
      crashPoint('bridge.reset')
    }
    submissionId = await journal.submit({ opId: op.opId, content: options.text?.() ?? op.text, kind: op.kind, steer: options.steer })
    crashPoint('bridge.submitted')
  }
  markSubmitted(store, op.opId, journal.incarnation, submissionId)
  return submissionId
}
