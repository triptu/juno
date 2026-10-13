import * as stylex from '@stylexjs/stylex'
import { forwardRef } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { LabelledRule } from '@juno/ui'

export interface NewDividerProps {
  readonly count: number
}

/**
 * The "3 new" rule before the first unread message (inventory 6.8). The
 * container holds a ref to it to open the topic with it 80px from the top.
 */
export const NewDivider = forwardRef<HTMLDivElement, NewDividerProps>(function NewDivider({ count }, ref) {
  return (
    <div ref={ref} data-new-divider="" {...stylex.props(styles.divider)}>
      <LabelledRule label={`${count} new`} />
    </div>
  )
})

const styles = stylex.create({
  divider: {
    marginTop: spacing['--space-3-5'],
    marginBottom: spacing['--space-1-5'],
    paddingInline: spacing['--space-2'],
  },
})
