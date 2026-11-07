import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { accent, colors, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'

interface StatusCardProps {
  /** The card's accessible name: "Sync", "Update". */
  readonly label: string
  /** The title line's accessible name, read as a status: "Sync status". */
  readonly statusLabel: string
  /** The ring, or the notice's icon, in a 20px slot. */
  readonly leading: ReactNode
  readonly title: string
  readonly line: string
  /** The full second line when it may be cut off. */
  readonly tooltip?: string
  readonly action?: ReactNode
  /** The two lines are a button that opens more about the card (the update's in Settings › About). */
  readonly onOpen?: () => void
  /** The button's accessible name, which starts with the title: "Update ready, Juno 0.1.15. Show in Settings". */
  readonly openLabel?: string
  /** Marks the card for tests and the gallery: `data-sync-status` or `data-update-status`. */
  readonly marker: 'sync' | 'update'
}

/**
 * The card at the foot of the sidebar: a 20px leading slot, a title and
 * one line under it, and an optional button. Every state is the same
 * height, so one state replacing another moves nothing. The sync status
 * and the downloaded update use it.
 */
export function StatusCard({ label, statusLabel, leading, title, line, tooltip, action, onOpen, openLabel, marker }: StatusCardProps) {
  const lines = (
    <>
      <Text variant="ui" weight="medium" tone="default" truncate role="status" aria-label={statusLabel} sx={styles.title}>
        {title}
      </Text>
      <Text variant="meta" tone="subtle" numeric truncate sx={styles.line}>
        {line}
      </Text>
    </>
  )
  return (
    <section aria-label={label} title={tooltip} data-sync-status={marker === 'sync' ? '' : undefined} data-update-status={marker === 'update' ? '' : undefined} {...stylex.props(styles.card)}>
      <span {...stylex.props(styles.leading)}>{leading}</span>
      {onOpen === undefined ? (
        <span {...stylex.props(styles.lines)}>{lines}</span>
      ) : (
        <button type="button" aria-label={openLabel} onClick={onOpen} {...stylex.props(styles.lines, styles.open)}>
          {lines}
        </button>
      )}
      {action}
    </section>
  )
}

const appear = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  // The privacy card's look, two lines tall: 10px around the 20px slot, the text and the button.
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    padding: spacing['--space-2-5'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-subtle'],
    animationName: appear,
    animationDuration: motion['--duration-appear'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  leading: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--icon-20'],
    height: sizes['--icon-20'],
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
  },
  // The lines as a button keep their look: no fill, no border, the text at the start. Only the keyboard's ring shows.
  open: {
    alignItems: 'stretch',
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-sm'],
    backgroundColor: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'start',
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-width'],
    outlineColor: accent['--focus-ring'],
  },
  title: { lineHeight: spacing['--space-5'] },
  line: { lineHeight: spacing['--space-4'] },
})
