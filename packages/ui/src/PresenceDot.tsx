import * as stylex from '@stylexjs/stylex'
import { colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'

/** The surface under the dot, which its ring matches. `subtle` is the sidebar's title bar and `raised` is a popover. */
type PresenceDotSurface = 'subtle' | 'raised'

export interface PresenceDotProps {
  /** Slack shows you as active. A green dot when true, a hollow ring when false. */
  readonly active: boolean
  readonly surface: PresenceDotSurface
}

/** 10px with a 2px ring in the surface colour (inventory 2.1). */
const DOT = '10px' // tokens-allow: the presence dot

/**
 * Whether Slack shows you as active, drawn on the bottom right corner of an
 * avatar. The dot is placed against the nearest positioned ancestor, so the
 * owner wraps the avatar in a `position: relative` box. Screen readers skip
 * the dot. The owner gives the state in words, as the menu's "Active" line
 * and the button's description do.
 */
export function PresenceDot({ active, surface }: PresenceDotProps) {
  return <span aria-hidden {...stylex.props(styles.dot, rings[surface], active ? styles.active : holes[surface])} />
}

const styles = stylex.create({
  dot: {
    position: 'absolute',
    right: `calc(-1 * ${spacing['--space-0-5']})`,
    bottom: `calc(-1 * ${spacing['--space-0-5']})`,
    width: DOT,
    height: DOT,
    boxSizing: 'border-box',
    borderRadius: radii['--radius-full'],
    borderWidth: sizes['--focus-ring-width'],
    borderStyle: 'solid',
    pointerEvents: 'none',
  },
  active: {
    backgroundColor: colors['--presence-active'],
  },
})

const rings = stylex.create({
  subtle: { borderColor: colors['--background-subtle'] },
  raised: { borderColor: colors['--surface-raised'] },
})

// When away, the dot is filled with the surface colour inside a 1px muted hairline.
const holes = stylex.create({
  subtle: {
    backgroundColor: colors['--background-subtle'],
    boxShadow: `inset 0 0 0 1px ${colors['--foreground-muted']}`, // tokens-allow: The inset ring is a 1px hairline.
  },
  raised: {
    backgroundColor: colors['--surface-raised'],
    boxShadow: `inset 0 0 0 1px ${colors['--foreground-muted']}`, // tokens-allow: The inset ring is a 1px hairline.
  },
})
