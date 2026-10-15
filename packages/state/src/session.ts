/** Atoms for the session feature. */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { sessionImportFromSlackApp, sessionSignIn, sessionSignOut, sessionStatus, type SessionStatus } from '@juno/contract'
import { command, liveQuery } from './atoms'
import { connectionStateAtom } from './client'

export const sessionStatusAtom = liveQuery(sessionStatus)(undefined)

export const signInCommand = command(sessionSignIn)
export const importFromSlackAppCommand = command(sessionImportFromSlackApp)
export const signOutCommand = command(sessionSignOut)

export type ReadySession = Extract<SessionStatus, { readonly _tag: 'ready' }>

interface HeldSession {
  readonly session: ReadySession | undefined
  /** The port was lost; the next engine's opening `signedOut` is its start, not a sign-out. */
  readonly restarting: boolean
}

/**
 * Every engine instance starts as `signedOut` and asks main for the stored
 * secrets before it is `ready`, so a restart would show the sign-in page for
 * a moment and unmount the shell. This keeps the last ready session through
 * that window: from the connection dropping until the new engine reports
 * anything other than `signedOut`. A sign-out by the user, a session that
 * Slack rejected (`authRequired`) and a sign-in in progress all come through
 * as they are.
 */
const heldSessionAtom = Atom.make((get): HeldSession => {
  const previous = Option.getOrElse(get.self<HeldSession>(), () => ({ session: undefined, restarting: false }))
  const connection = get(connectionStateAtom)
  const status = get(sessionStatusAtom)
  const restarting = connection === 'reconnecting' || previous.restarting
  if (status._tag !== 'Success') return { session: previous.session, restarting }
  switch (status.value._tag) {
    case 'ready':
      // The same object is the old engine's answer still in the atom; a new one ends the restart.
      return { session: status.value, restarting: status.value === previous.session && restarting }
    case 'authRequired':
      return { session: undefined, restarting: false }
    case 'signingIn':
      return { session: previous.session, restarting: false }
    case 'signedOut':
      return { session: restarting ? previous.session : undefined, restarting }
  }
}).pipe(Atom.keepAlive)

/** The session the shell is built around, or undefined when the sign-in page should show. */
export const signedInAtom = Atom.make((get): ReadySession | undefined => get(heldSessionAtom).session)

/**
 * The "Set up Juno" step (SPEC section 13.10, "Set up Juno"): true from a
 * first sign-in started in this run until the owner sets up a model or
 * skips. The step shows only once signed in, and only while no provider is
 * active. Not kept across a relaunch: after one, "Juno needs a model" in the
 * Juno tab is the way back.
 */
export const junoSetupPendingAtom = Atom.make(false).pipe(Atom.keepAlive)
