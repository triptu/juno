import * as stylex from '@stylexjs/stylex'
import { ArrowCircleUp } from '@phosphor-icons/react/dist/icons/ArrowCircleUp'
import { accent } from '@juno/tokens/tokens.stylex'
import { Button, Icon } from '@juno/ui'
import { StatusCard } from './StatusCard'

export interface UpdateReadyProps {
  /** The downloaded version, "0.1.15". */
  readonly version: string
  /** Installs it: the same restart as Settings › About's Restart to update. */
  readonly onRestart: () => void
  /** The card's text: Settings › About, with What's new. */
  readonly onOpen: () => void
}

/**
 * A downloaded update at the foot of the sidebar (SPEC 5, item 5): "Update
 * ready", the version, and Restart. In the sync status card's shape, so it
 * sits in the footer as that card does and the list above it never moves.
 */
export function UpdateReady({ version, onRestart, onOpen }: UpdateReadyProps) {
  return (
    <StatusCard
      label="Update"
      statusLabel="Update status"
      marker="update"
      leading={
        <span {...stylex.props(styles.icon)}>
          <Icon icon={ArrowCircleUp} size={18} weight="fill" />
        </span>
      }
      title="Update ready"
      line={`Juno ${version}`}
      tooltip={`Juno ${version} is downloaded. Restart Juno to install it.`}
      onOpen={onOpen}
      openLabel={`Update ready, Juno ${version}. Show in Settings`}
      action={
        <Button variant="raised" size="xs" aria-label="Restart to update" onClick={onRestart}>
          Restart
        </Button>
      }
    />
  )
}

const styles = stylex.create({
  // The accent, so the card reads as news rather than a problem.
  icon: { display: 'inline-flex', color: accent['--hl'] },
})
