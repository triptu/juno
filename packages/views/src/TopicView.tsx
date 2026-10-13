import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, spacing, z } from '@juno/tokens/tokens.stylex'

export interface TopicViewProps {
  /** The `TopicHeader`. */
  readonly header: ReactNode
  /** The `MessageList`, or whatever the container shows in its place. */
  readonly children: ReactNode
  /** The `NewMessagesPill`, floated over the bottom of the list while scrolled up. */
  readonly pill?: ReactNode
  /** The `ComposerSlot` now, the composer from M6. */
  readonly composer?: ReactNode
}

/**
 * One topic in a tab (SPEC section 7): the header, the list filling the
 * middle, and the composer at the bottom. The pill floats over the list's
 * bottom edge and never takes part in its layout.
 */
export function TopicView({ header, children, pill, composer }: TopicViewProps) {
  return (
    <div data-topic-view="" {...stylex.props(styles.root)}>
      {header}
      <div {...stylex.props(styles.middle)}>
        {children}
        {pill !== undefined ? <div {...stylex.props(styles.pill)}>{pill}</div> : null}
      </div>
      {composer}
    </div>
  )
}

const styles = stylex.create({
  // Fills whatever holds it (the workspace page, a gallery frame) and
  // keeps its own height to that, so the list scrolls instead of growing.
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors['--background'],
  },
  middle: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
  },
  // Centred over the list's bottom edge. The wrapper is only as wide as the
  // pill, so the rows beside it stay clickable.
  pill: {
    position: 'absolute',
    bottom: spacing['--space-3'],
    left: '50%',
    translate: '-50% 0',
    display: 'inline-flex',
    zIndex: z['--z-toolbar'],
  },
})
