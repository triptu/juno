import * as stylex from '@stylexjs/stylex'
import { Headphones } from '@phosphor-icons/react/dist/icons/Headphones'
import { colors } from '@juno/tokens/tokens.stylex'
import { Icon, tooltip } from '@juno/ui'

export interface HuddleIndicatorProps {
  /** How many people are in the huddle. */
  readonly count: number
}

/** "Huddle with 3 people": the indicator's name and tooltip. */
export function huddleIndicatorLabel(count: number): string {
  return count === 1 ? 'Huddle with 1 person' : `Huddle with ${count} people`
}

/**
 * Small green headphones after a Main row's title while a huddle runs in
 * its channel or DM (SPEC 20). It takes only its own width, beside the
 * thread count, and adds the huddle to the row's name.
 */
export function HuddleIndicator({ count }: HuddleIndicatorProps) {
  const label = huddleIndicatorLabel(count)
  return (
    <span role="img" aria-label={label} {...tooltip(label)} data-huddle-indicator="" {...stylex.props(styles.root)}>
      <Icon icon={Headphones} size={12} weight="fill" />
    </span>
  )
}

const styles = stylex.create({
  root: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--huddle-live'],
  },
})
