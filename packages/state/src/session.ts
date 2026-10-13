/** Atoms for the session feature. */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { sessionImportFromSlackApp, sessionSignIn, sessionSignOut, sessionStatus, type SessionStatus } from '@juno/contract'
import { command, liveQuery } from './atoms'

export const sessionStatusAtom = liveQuery(sessionStatus)(undefined)

export const signInCommand = command(sessionSignIn)
export const importFromSlackAppCommand = command(sessionImportFromSlackApp)
export const signOutCommand = command(sessionSignOut)

export type ReadySession = Extract<SessionStatus, { readonly _tag: 'ready' }>

/**
 * The session the shell is built around: the last `ready` status, held
 * while the engine restarts and the status query re-subscribes, so the
 * signed-in window does not fall back to the sign-in page for a moment
 * (and lose its open menu) on every engine restart. A `signedOut` or
 * `authRequired` status clears it.
 */
export const signedInAtom = Atom.make((get): ReadySession | undefined => {
  const status = get(sessionStatusAtom)
  if (status._tag === 'Success') return status.value._tag === 'ready' ? status.value : undefined
  // Waiting for the new engine's first answer: keep what the shell showed.
  return Option.getOrUndefined(get.self<ReadySession | undefined>())
}).pipe(Atom.keepAlive)
