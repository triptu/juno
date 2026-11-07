/**
 * A person's status under their avatar's tooltip (SPEC 7, "People"): the
 * tooltip layer asks for it when the hovered control names a person
 * (`data-tooltip-person`). Nothing shows while the engine has not said or
 * when they have none; the engine sends the change when a status expires.
 */
import { useState, type ReactNode } from 'react'
import { statusUntil } from '@juno/contract'
import { personStatusAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { StatusLine } from '@juno/views'

function PersonStatus({ userId }: { readonly userId: string }) {
  const status = useAtomValue(personStatusAtom(userId))
  // "until" is read as of the hover: a tooltip shows for seconds.
  const [shownAt] = useState(() => new Date())
  if (status === undefined || status === null) return null
  return <StatusLine emoji={status.emoji} text={status.text} until={status.expiresAt === undefined ? undefined : statusUntil(status.expiresAt, shownAt)} />
}

/** The tooltip's detail line for a control that names a person. */
export function tooltipDetail(target: HTMLElement): ReactNode {
  const userId = target.dataset.tooltipPerson
  return userId === undefined || userId === '' ? undefined : <PersonStatus userId={userId} />
}
