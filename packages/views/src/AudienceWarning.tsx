import * as stylex from '@stylexjs/stylex'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { radii, spacing, tints } from '@juno/tokens/tokens.stylex'
import { Icon, Text } from '@juno/ui'

export interface AudienceWarningProps {
  /** "This reads like hiring or people detail. eng is a public channel." */
  readonly message: string
}

/**
 * The quiet amber line at the top of the composer while the draft reads like
 * hiring or people details in a public channel (spec section 8, inventory
 * 7.2). It warns and never blocks.
 */
export function AudienceWarning({ message }: AudienceWarningProps) {
  return (
    <div data-audience-warning="" role="status" {...stylex.props(styles.line)}>
      <span aria-hidden {...stylex.props(styles.icon)}>
        <Icon icon={Sparkle} size={14} />
      </span>
      <Text variant="meta" tone="inherit">
        {message}
      </Text>
    </div>
  )
}

const styles = stylex.create({
  line: {
    display: 'flex',
    alignItems: 'center',
    // The icon and the text start where the check bar's do (SendCheckBar),
    // so the two lines stacked in the composer share one edge.
    gap: spacing['--space-2-5'],
    marginTop: spacing['--space-1-5'],
    marginInline: spacing['--space-1-5'],
    paddingBlock: spacing['--space-1-5'],
    paddingInlineStart: spacing['--space-3'],
    paddingInlineEnd: spacing['--space-2-5'],
    // The composer's one inset (6px, as the chips and the attach and send
    // buttons), and concentric with its 20px corners.
    borderRadius: radii['--radius-2xl'],
    backgroundColor: tints['--tint-warning-bg'],
    color: tints['--tint-warning-fg'],
  },
  icon: {
    display: 'inline-flex',
    flexShrink: 0,
  },
})
