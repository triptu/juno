import { ArrowDown } from '@phosphor-icons/react/dist/icons/ArrowDown'
import { Button } from '@juno/ui'

export interface NewMessagesPillProps {
  /** Messages that arrived while scrolled up. 0 reads "Jump to latest". */
  readonly count: number
  readonly onJump: () => void
}

/** The pill over the bottom of the list while the user is scrolled up (performance 3.3). */
export function NewMessagesPill({ count, onJump }: NewMessagesPillProps) {
  const label = count <= 0 ? 'Jump to latest' : count === 1 ? '1 new message' : `${count} new messages`
  return (
    <Button variant="raised" size="sm" iconStart={ArrowDown} onClick={onJump}>
      {label}
    </Button>
  )
}
