import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import { dayLabel } from '../time'

export interface DaySeparatorProps {
  /** The start of the day, in ms. */
  readonly at: number
  readonly now: number
}

/** "Today", "Yesterday", "Sat", "Oct 3": the centred day label between groups, 20px around (inventory 12). */
export const DaySeparator = memo(function DaySeparator({ at, now }: DaySeparatorProps) {
  return (
    <div data-chat-day={at} {...stylex.props(styles.root)}>
      <Text variant="divider" tone="muted" numeric>
        {dayLabel(at, now)}
      </Text>
    </div>
  )
})

const styles = stylex.create({
  root: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: spacing['--space-5'],
    // The 8px group gap of the next row brings the total under the label to 20px.
    marginBottom: spacing['--space-3'],
    userSelect: 'none',
  },
})
