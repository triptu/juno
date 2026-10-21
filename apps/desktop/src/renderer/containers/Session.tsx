import type { SignInFailed } from '@juno/contract'
import { copyText, errorOf, importFromSlackAppCommand, junoSetupPendingAtom, registry, sessionStatusAtom, signOutCommand } from '@juno/state'
import { agentProviderAtom } from '@juno/state/agent'
import { useAtomSet, useAtomValue } from '@juno/state/react'
import { SessionView, SignInView } from '@juno/views'

/** UI copy for a failed attempt (SPEC section 17: plain, one sentence, says what to do next). */
function failureLine(error: SignInFailed): string {
  switch (error.kind) {
    case 'no-token':
      return 'Juno could not read the Slack app’s session. Open Slack, sign in there, then try again.'
    case 'no-slack-app':
      return 'Slack isn’t installed on this Mac. Install Slack, sign in to it, then try again.'
    case 'slack-signed-out':
      return 'Slack is installed but not signed in. Open Slack, sign in there, then try again.'
    case 'keychain':
      // Main's line says which: refused, missing, did not unlock, or try the next item.
      return error.message
    case 'rejected':
      return 'Slack did not accept the session. Open Slack, sign in there, then try again.'
    case 'offline':
      return 'Slack could not be reached. Check the connection and try again.'
    case 'other':
      return error.message
  }
}

/** Wires the session live value and the session commands to the sign-in and session views. */
export function Session() {
  const status = useAtomValue(sessionStatusAtom)
  const importResult = useAtomValue(importFromSlackAppCommand)
  const signOutResult = useAtomValue(signOutCommand)
  const importSession = useAtomSet(importFromSlackAppCommand)
  const signOut = useAtomSet(signOutCommand)
  // Read now, so it is known by the time the owner presses a sign-in button.
  const noProvider = useAtomValue(agentProviderAtom, (state) => state?.active === null)
  const failed = importResult.waiting ? undefined : errorOf(importResult)
  // A transport failure (the engine restarting) is retried by the state layer and not shown.
  const error = failed?._tag === 'SignInFailed' ? failureLine(failed) : undefined
  const details = failed?._tag === 'SignInFailed' ? failed.details : undefined

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

  const mode = value._tag === 'authRequired' ? 'expired' : 'first-run'
  // A first sign-in with no model set up is followed by "Set up Juno" (SPEC 13.10).
  const setUpAfter = () => registry.set(junoSetupPendingAtom, mode === 'first-run' && noProvider)
  return (
    <SignInView
      mode={mode}
      {...(value._tag === 'signingIn' ? { busy: value.method } : {})}
      {...(error === undefined ? {} : { error })}
      {...(details === undefined ? {} : { onCopyDetails: () => copyText(details) })}
      onImport={() => {
        setUpAfter()
        importSession(undefined)
      }}
    />
  )
}
