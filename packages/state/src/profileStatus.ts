/**
 * Slack profile status (SPEC 14, "Your status"; contract `routes/status.ts`).
 * `personStatusAtom` follows one person's status, so only what shows it
 * re-renders when it changes or clears. The engine sends the change when
 * a status expires.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { statusOf, statusSet, type ProfileStatus, type StatusClearAfterChoice } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

const statusQuery = liveQuery(statusOf)

/** Whether the status sheet is open (Set a status, or your status, in the avatar menu). */
export const statusSheetOpenAtom = Atom.make(false).pipe(Atom.keepAlive)

/** The person's status: null when they have none or it has expired, undefined until the engine has said, and for an empty id. */
export const personStatusAtom = Atom.family((userId: string) =>
  Atom.make((get): ProfileStatus | null | undefined => {
    if (userId === '') return undefined
    const result = get(statusQuery({ userId }))
    return AsyncResult.isSuccess(result) ? result.value : undefined
  }),
)

/** Sets your status, or clears it with empty text and emoji. Settles once Slack has answered. */
export const setOwnStatus = (registry: Registry, input: { readonly text: string; readonly emoji: string; readonly clearAfter: StatusClearAfterChoice }) =>
  runCommand(registry, statusSet, input)
