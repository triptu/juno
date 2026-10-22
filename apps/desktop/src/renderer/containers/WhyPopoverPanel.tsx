import { junoAvailableAtom, whyPopoverAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { WhyPopover } from '@juno/views'
import { tellJunoAbout } from './juno/actions'
import { messageQuote } from './juno/topicSelection'
import { changeFromWhy, closeWhy } from './notifyActions'

/** Tell Juno: the Juno chat beside the topic with the message quoted, read before the popover closes. */
function tellJuno(topicId: string, ts: string): void {
  const quote = messageQuote(ts)
  closeWhy()
  tellJunoAbout(topicId, quote)
}

/** The why popover, over everything, where the message menu opened. Tell Juno shows only while AI assist is on. */
export function WhyPopoverPanel() {
  const popover = useAtomValue(whyPopoverAtom)
  const junoAvailable = useAtomValue(junoAvailableAtom)
  if (popover === undefined) return null
  const { why, at, topicId, ts } = popover
  const action =
    why.action.kind === 'change' || why.action.kind === 'hours'
      ? { label: 'Change' as const, onAction: () => void changeFromWhy(why, at) }
      : why.action.kind === 'juno' && junoAvailable
        ? { label: 'Tell Juno' as const, onAction: () => tellJuno(topicId, ts) }
        : undefined
  return <WhyPopover at={at} title={why.title} reason={why.reason} {...(action === undefined ? {} : { action })} onClose={closeWhy} />
}
