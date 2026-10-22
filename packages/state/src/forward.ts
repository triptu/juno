/**
 * Forward (spec section 7, "Forward"): the sheet's state and the command.
 *
 * The message menu opens the sheet with the message it forwards; the sheet
 * picks one destination and an optional note, and `forwardMessage` queues
 * the forward. Like a send, it answers once the engine has queued it: the
 * forward shows in the destination at once and the outbox posts it.
 */
import * as Atom from 'effect/reactivity/Atom'
import { messagesForward, type MessageView, type Person, type SendTarget } from '@juno/contract'
import { runCommand } from './atoms'
import type { Registry } from './client'
import { releaseSidebarTopic } from './sidebar'

/** The message the open sheet forwards, as the list showed it, with its sender and where it was posted ("#eng"). */
export interface ForwardSheetState {
  readonly channelId: string
  readonly message: MessageView
  readonly sender: Person | undefined
  readonly place: string
}

export const forwardSheetAtom = Atom.make<ForwardSheetState | undefined>(undefined).pipe(Atom.keepAlive)

/** Queues a forward of the stored message `source` to `to`'s Main, with `note` above it. Resolves with the `Exit`; on success, the destination's topic. */
export const forwardMessage = async (registry: Registry, to: SendTarget, note: string, source: { readonly channelId: string; readonly ts: string }) => {
  const exit = await runCommand(registry, messagesForward, { to, note, clientMsgId: crypto.randomUUID(), source })
  // Your own forward moves the destination's row at once, as a send does.
  if (exit._tag === 'Success') releaseSidebarTopic(registry, exit.value.topicId)
  return exit
}
