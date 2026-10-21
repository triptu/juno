/** Atoms for the session feature. */
import { Option, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { ReadySession, sessionImportFromSlackApp, sessionSignOut, sessionProfile, sessionStatus } from '@juno/contract'
import { command, liveQuery } from './atoms'
import { launchParam } from './shell'

export type { ReadySession } from '@juno/contract'

export const sessionProfileAtom = liveQuery(sessionProfile)(undefined)

export const sessionStatusAtom = liveQuery(sessionStatus)(undefined)

export const importFromSlackAppCommand = command(sessionImportFromSlackApp)
export const signOutCommand = command(sessionSignOut)

const decodeSaved = Schema.decodeUnknownOption(Schema.fromJsonString(ReadySession))

/**
 * The session main saved when it was last verified, from the page's
 * `?session=` (no secrets). With it the first render is the shell, not the
 * sign-in page, while the engine reads and checks the stored session.
 */
function savedSession(): ReadySession | undefined {
  const param = launchParam('session')
  return param === undefined ? undefined : Option.getOrUndefined(decodeSaved(decodeURIComponent(param.replaceAll('+', ' '))))
}

interface HeldSession {
  readonly session: ReadySession | undefined
  /** Whether the page knows which to show: the shell or the sign-in page. */
  readonly known: boolean
}

/**
 * The session the page is built around. It starts from the saved session,
 * and an engine that is `starting` (at launch, or after a restart) or not
 * answering yet changes nothing: the shell stays, and the sign-in page does
 * not show before the engine has said there is no session. A sign-out, a
 * session Slack rejected (`authRequired`) and a sign-in in progress come
 * through as they are.
 */
const heldSessionAtom = Atom.make((get): HeldSession => {
  const previous = Option.getOrElse(get.self<HeldSession>(), () => {
    const saved = savedSession()
    return { session: saved, known: saved !== undefined }
  })
  const status = get(sessionStatusAtom)
  if (status._tag !== 'Success') return previous
  switch (status.value._tag) {
    case 'starting':
      return previous
    case 'ready':
      return { session: status.value, known: true }
    case 'signingIn':
      return { session: previous.session, known: true }
    case 'authRequired':
    case 'signedOut':
      return { session: undefined, known: true }
  }
}).pipe(Atom.keepAlive)

/** The session the shell is built around, or undefined when the sign-in page should show. */
export const signedInAtom = Atom.make((get): ReadySession | undefined => get(heldSessionAtom).session)

/** True until the page knows whether to show the shell or the sign-in page: a launch with no saved session, before the engine answers. */
export const sessionUnknownAtom = Atom.make((get) => !get(heldSessionAtom).known)

/**
 * The "Set up Juno" step (SPEC section 13.10, "Set up Juno"): true from a
 * first sign-in started in this run until the owner sets up a model or
 * skips. The step shows only once signed in, and only while no provider is
 * active. Not kept across a relaunch: after one, "Juno needs a model" in the
 * Juno tab is the way back.
 */
export const junoSetupPendingAtom = Atom.make(false).pipe(Atom.keepAlive)
