import { useState } from 'react'
import type { SignInFailed } from '@juno/contract'
import { errorOf, importFromSlackAppCommand, sessionStatusAtom, signInCommand, signOutCommand } from '@juno/state'
import { useAtomSet, useAtomValue } from '@juno/state/react'
import { SessionView, SignInView } from '@juno/views'

/** UI copy for a failed attempt (SPEC section 17: plain, one sentence, says what to do next). */
function failureLine(error: SignInFailed): string {
  switch (error.kind) {
    case 'cancelled':
      return 'The sign-in window was closed before it finished.'
    case 'no-token':
      return 'Slack signed in, but Juno could not read the session. Try again.'
    case 'no-slack-app':
      return 'No signed-in Slack app was found on this Mac.'
    case 'keychain':
      return 'Juno could not read the Slack keychain item. Allow access when macOS asks, or sign in instead.'
    case 'rejected':
      return 'Slack did not accept the session. Sign in again.'
    case 'offline':
      return 'Slack could not be reached. Check the connection and try again.'
    case 'other':
      return error.message
  }
}

/** Wires the session live value and the three session commands to the sign-in and session views. */
export function Session() {
  const status = useAtomValue(sessionStatusAtom)
  const signInResult = useAtomValue(signInCommand)
  const importResult = useAtomValue(importFromSlackAppCommand)
  const signOutResult = useAtomValue(signOutCommand)
  const signIn = useAtomSet(signInCommand)
  const importSession = useAtomSet(importFromSlackAppCommand)
  const signOut = useAtomSet(signOutCommand)
  // Which action ran last decides whose failure is shown.
  const [last, setLast] = useState<'window' | 'import' | undefined>(undefined)
  const result = last === 'import' ? importResult : last === 'window' ? signInResult : undefined
  const failed = result === undefined || result.waiting ? undefined : errorOf(result)
  // A transport failure (the engine restarting) is retried by the state layer and not shown.
  const error = failed?._tag === 'SignInFailed' ? failureLine(failed) : undefined

  if (status._tag !== 'Success') return null
  const value = status.value

  if (value._tag === 'ready') {
    return (
      <SessionView
        teamName={value.teamName}
        userName={value.userName}
        {...(value.enterprise?.name === undefined ? {} : { enterpriseName: value.enterprise.name })}
        signingOut={signOutResult.waiting}
        onSignOut={() => signOut(undefined)}
      />
    )
  }

  return (
    <SignInView
      mode={value._tag === 'authRequired' ? 'expired' : 'first-run'}
      {...(value._tag === 'signingIn' ? { busy: value.method } : {})}
      {...(error === undefined ? {} : { error })}
      onSignIn={() => {
        setLast('window')
        signIn(undefined)
      }}
      onImport={() => {
        setLast('import')
        importSession(undefined)
      }}
    />
  )
}
