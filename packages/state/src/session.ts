/** Atoms for the session feature. */
import { sessionImportFromSlackApp, sessionSignIn, sessionSignOut, sessionStatus } from '@juno/contract'
import { command, liveQuery } from './atoms'

export const sessionStatusAtom = liveQuery(sessionStatus)(undefined)

export const signInCommand = command(sessionSignIn)
export const importFromSlackAppCommand = command(sessionImportFromSlackApp)
export const signOutCommand = command(sessionSignOut)
