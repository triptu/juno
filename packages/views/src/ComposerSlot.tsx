import * as stylex from '@stylexjs/stylex'
import { ArrowUp } from '@phosphor-icons/react/dist/icons/ArrowUp'
import { accent, layout, opacity, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, Surface, Text } from '@juno/ui'

export interface ComposerSlotProps {
  /** "Reply" in threads, "Message #eng" or "Message Maya Chen" in Main. */
  readonly placeholder: string
}

/**
 * Where the composer goes (inventory 7), at the composer's single-line
 * height, so M6 swaps the real one in with no shift. Inert: it draws the
 * frame, the placeholder and the send mark, and takes no input.
 */
export function ComposerSlot({ placeholder }: ComposerSlotProps) {
  return (
    <div data-composer-slot="" {...stylex.props(styles.outer)}>
      <Surface kind="field" aria-hidden data-composer-field="" sx={styles.box}>
        <Text variant="body" tone="muted" sx={styles.placeholder}>
          {placeholder}
        </Text>
        <span {...stylex.props(styles.mark, styles.send)}>
          <Icon icon={ArrowUp} size={16} weight="bold" />
        </span>
      </Surface>
    </div>
  )
}

const styles = stylex.create({
  outer: {
    flexShrink: 0,
    width: '100%',
    paddingTop: spacing['--space-2'],
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-5'],
    boxSizing: 'border-box',
    userSelect: 'none',
  },
  box: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    width: '100%',
    maxWidth: layout['--composer-width'],
    height: sizes['--control-40'],
    marginInline: 'auto',
    // The composer's: its text starts 18px in (14 here, then the textarea's 4).
    paddingInlineStart: spacing['--space-3-5'],
    paddingInlineEnd: spacing['--space-1-5'],
  },
  mark: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-28'],
    height: sizes['--control-28'],
    borderRadius: radii['--radius-full'],
  },
  send: {
    color: accent['--hl-fg'],
    backgroundColor: accent['--hl'],
    opacity: opacity['--opacity-disabled'],
  },
  placeholder: {
    flexGrow: 1,
    paddingInlineStart: spacing['--space-1'],
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
})
