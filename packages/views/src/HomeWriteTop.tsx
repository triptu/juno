import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { layout, spacing } from '@juno/tokens/tokens.stylex'

interface HomeWriteTopProps {
  readonly chip: ReactNode
  /** The topic chip, right of the destination chip: pass it only while a person or channel is chosen. */
  readonly topic?: ReactNode
}

/**
 * The destination chip and the topic chip, on one row above the field. The
 * topic chip comes and goes right of the destination chip, so neither the
 * destination chip nor the field moves. On a narrow window the topic chip
 * shortens first, to --topic-chip-min-width, then the destination chip.
 */
export function HomeWriteTop({ chip, topic }: HomeWriteTopProps) {
  return (
    <div data-home-write="" {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.chipSlot)}>{chip}</span>
      {topic === undefined ? null : (
        <span data-topic-chip="" {...stylex.props(styles.topicSlot)}>
          {topic}
        </span>
      )}
    </div>
  )
}

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    width: '100%',
    minWidth: 0,
  },
  // The destination chip gives way only once the topic chip is at its narrowest.
  chipSlot: {
    display: 'inline-flex',
    flexShrink: 1,
    minWidth: 0,
  },
  topicSlot: {
    display: 'inline-flex',
    flexShrink: 10000,
    minWidth: layout['--topic-chip-min-width'],
  },
})
