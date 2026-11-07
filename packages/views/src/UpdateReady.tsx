import * as stylex from '@stylexjs/stylex'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { accent, colors, motion, radii, shadows, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Icon, Text } from '@juno/ui'

export interface UpdateReadyProps {
  /** Installs it: the same restart as Settings › About's Restart to update. */
  readonly onRestart: () => void
  /** The pill's text: Settings › About, with What's new. */
  readonly onOpen: () => void
}

/**
 * A downloaded update (SPEC 5, item 5): a small pill floating over the foot
 * of the sidebar's list, with "Update ready" and Restart. No version and no
 * accent colour, so it reads as good news, not a problem.
 */
export function UpdateReady({ onRestart, onOpen }: UpdateReadyProps) {
  return (
    <section aria-label="Update" data-update-status="" {...stylex.props(styles.pill)}>
      <button type="button" aria-label="Update ready. Show in Settings" onClick={onOpen} {...stylex.props(styles.open)}>
        <Icon icon={Sparkle} size={14} weight="fill" />
        <Text variant="ui" weight="medium" tone="default" role="status" aria-label="Update status">
          Update ready
        </Text>
      </button>
      <Button variant="secondary" size="xs" aria-label="Restart to update" onClick={onRestart}>
        Restart
      </Button>
    </section>
  )
}

const appear = stylex.keyframes({
  from: { opacity: 0, transform: `translateY(${spacing['--space-1']})` },
  to: { opacity: 1, transform: 'none' },
})

const styles = stylex.create({
  // 30px tall: the 22px Restart 4px from the edge, and the text as far from the start as Restart's label is from its own.
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    height: sizes['--control-30'],
    paddingInline: spacing['--space-1'],
    borderRadius: radii['--radius-full'],
    backgroundColor: colors['--surface-raised'],
    boxShadow: shadows['--panel-shadow'],
    color: colors['--foreground-subtle'],
    whiteSpace: 'nowrap',
    animationName: appear,
    animationDuration: motion['--duration-appear'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  // The icon and text as a button: the hover fill in its own pill, as tall as Restart, and the keyboard's ring.
  open: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    height: sizes['--control-22'],
    paddingInline: spacing['--space-2'],
    borderWidth: 0,
    borderRadius: radii['--radius-full'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, '@media (hover: hover)': colors['--surface-hover'] },
      ':active': { default: colors['--surface-active'], '@media (hover: hover)': colors['--surface-active'] },
    },
    color: 'inherit',
    font: 'inherit',
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineColor: accent['--focus-ring'],
  },
})
