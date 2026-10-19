import * as stylex from '@stylexjs/stylex'
import { colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'

/** The surface under the dot, which its ring matches. `subtle` is the sidebar's title bar and `raised` is a popover. */
type PresenceDotSurface = 'subtle' | 'raised'

export interface PresenceDotProps {
  /** Slack shows you as active. A green dot when true, a hollow ring when false. */
  readonly active: boolean
  readonly surface: PresenceDotSurface
  /** Notifications are paused: a snooze badge (a "z" in an open circle) takes the dot's place, as Slack shows it. */
  readonly paused?: boolean
}

/** 10px with a 2px ring in the surface colour (inventory 2.1). */
const DOT = '10px' // tokens-allow: the presence dot
/** The paused badge: a 10px snooze glyph inside the same 2px ring, so it reads at the avatar's corner. */
const BADGE = '14px' // tokens-allow: the paused badge
const GLYPH = 10

/**
 * Whether Slack shows you as active, drawn on the bottom right corner of an
 * avatar. The dot is placed against the nearest positioned ancestor, so the
 * owner wraps the avatar in a `position: relative` box. Screen readers skip
 * the dot. The owner gives the state in words, as the menu's "Active" line
 * and the button's description do. While notifications are paused a
 * snooze badge takes the dot's place, as Slack shows it; presence is then
 * given in words only.
 */
export function PresenceDot({ active, surface, paused = false }: PresenceDotProps) {
  if (paused) {
    return (
      <span aria-hidden data-paused {...stylex.props(styles.dot, styles.badge, rings[surface], fills[surface])}>
        <Snooze />
      </span>
    )
  }
  return <span aria-hidden {...stylex.props(styles.dot, rings[surface], active ? styles.active : holes[surface])} />
}

/** Slack's snooze mark: a "z" breaking out of an open circle. Phosphor has no such glyph. */
function Snooze() {
  return (
    <svg width={GLYPH} height={GLYPH} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" focusable={false}>
      <path d="M3.6 2.2 A4.9 4.9 0 1 0 10.9 8" />
      <path d="M5.6 1 H11 L5.6 6.2 H11" />
    </svg>
  )
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
  // Paused says nothing about presence, so the glyph takes the text colour, never the presence green.
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: BADGE,
    height: BADGE,
    color: colors['--foreground-default'],
  },
})

const fills = stylex.create({
  subtle: { backgroundColor: colors['--background-subtle'] },
  raised: { backgroundColor: colors['--surface-raised'] },
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
