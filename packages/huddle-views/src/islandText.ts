import * as stylex from '@stylexjs/stylex'
import { colors, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

/**
 * A 28px text button with the island controls' fills, as the header islands'
 * controls in `@juno/views` have them: Leave, Thread and the header's Join. The owner adds the radius and any padding of its own.
 */
export const islandText = stylex.create({
  base: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    gap: spacing['--space-1-5'],
    height: sizes['--control-28'],
    minWidth: sizes['--control-28'],
    margin: 0,
    paddingBlock: 0,
    paddingInline: spacing['--space-2-5'],
    boxSizing: 'border-box',
    borderWidth: 0,
    color: colors['--foreground-default'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
    cursor: 'default',
    WebkitAppRegion: 'no-drag',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--secondary-default'] },
      ':active': { default: colors['--secondary-default'], [HOVER]: colors['--secondary-default'] },
    },
    transitionProperty: 'background-color',
    transitionDuration: '0s',
  },
  icon: {
    display: 'inline-flex',
    color: colors['--foreground-subtle'],
  },
})
