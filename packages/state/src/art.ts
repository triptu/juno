/** Redraw commands; topic art is read from topic and sidebar snapshots. */
import { artAvailable, artRedraw, type AiUnavailable } from '@juno/contract'
import { Cause, Exit, Option } from 'effect'
import { runCommand } from './atoms'
import type { Registry } from './client'
import { runActionExit, type ToastContent } from './undo'

/** Why a redraw made no new drawing: the engine's reason, or `other` for anything else. */
export type RedrawProblem = AiUnavailable['reason'] | 'other'

/** Whether Redraw art can draw now (`art.available`): AI assist on, a key, and the spend cap not reached. False when the engine does not answer. */
export async function canRedraw(registry: Registry): Promise<boolean> {
  const exit = await runCommand(registry, artAvailable, undefined)
  return exit._tag === 'Success' && exit.value
}

/**
 * "Redraw art": a new drawing for the topic, in place of the stored one. Keeps
 * its undo and shows `toast` once the engine has stored it. Resolves with
 * why it could not, or undefined when it did.
 */
export async function redrawTopic(registry: Registry, id: string, toast: ToastContent): Promise<RedrawProblem | undefined> {
  const exit = await runActionExit(registry, artRedraw, { id }, toast)
  if (Exit.isSuccess(exit)) return undefined
  const error = Cause.findErrorOption(exit.cause)
  return Option.isSome(error) && typeof error.value === 'object' && error.value !== null && (error.value as { _tag?: unknown })._tag === 'AiUnavailable'
    ? (error.value as AiUnavailable).reason
    : 'other'
}
