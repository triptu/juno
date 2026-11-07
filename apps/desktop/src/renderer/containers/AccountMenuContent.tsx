import type { ComponentProps } from 'react'
import { sessionStatusAtom, signOutCommand } from '@juno/state'
import { useAtomSet, useAtomValue } from '@juno/state/react'
import { AccountMenu } from '@juno/views'

/** The account menu with Sign out and who is signed in, once the session is ready. */
export default function AccountMenuContent(props: Omit<ComponentProps<typeof AccountMenu>, 'session'>) {
  const status = useAtomValue(sessionStatusAtom)
  const signingOut = useAtomValue(signOutCommand, (result) => result.waiting)
  const signOut = useAtomSet(signOutCommand)
  const ready = status._tag === 'Success' && status.value._tag === 'ready' ? status.value : undefined
  if (ready === undefined) return <AccountMenu {...props} />
  const where = ready.enterprise?.name === undefined ? ready.teamName : `${ready.teamName} (${ready.enterprise.name})`
  return <AccountMenu {...props} session={{ line: `Signed in to ${where} as ${ready.userName}`, signingOut, onSignOut: () => signOut(undefined) }} />
}
