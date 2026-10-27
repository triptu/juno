import * as stylex from '@stylexjs/stylex'
import { colors, radii, sizes } from '@juno/tokens/tokens.stylex'

/** The surface under the dot, which its ring matches. `subtle` is the sidebar's title bar and `raised` is a popover. */
type PresenceDotSurface = 'subtle' | 'raised'

/**
 * A sidebar row, plain or selected. As the avatar stack's rings on the same
 * rows, the ring keeps the plain fill under the pointer: following the hover
 * fill would not fit the initial style sheet's budget. A row shows only the
 * active dot: away and paused draw nothing there.
 */
type RowSurface = 'row' | 'rowSelected'

/**
 * `inline`: in a line of text, in place of an icon (the topic header's DM
 * pill), not on an avatar. 8px with no ring; away is a hollow ring in the
 * text's colour.
 */
type InlineSurface = 'inline'

export interface PresenceDotProps {
  /** Slack shows the person as active. A green dot when true, a hollow ring when false (nothing on a row). */
  readonly active: boolean
  readonly surface: PresenceDotSurface | RowSurface | InlineSurface
  /** Notifications are paused: a snooze badge (a "z" in an open circle) takes the dot's place, as Slack shows it, green while active. Not on a row. */
  readonly paused?: boolean
}

/** The paused badge: a 10px snooze glyph inside the same 2px ring, so it reads at the avatar's corner. */
const BADGE = '14px' // tokens-allow: the paused badge
/** 10px with a 2px ring in the surface colour (inventory 2.1). */
const DOT = '10px' // tokens-allow: the presence dot
/**
 * How far in from the avatar box's right and bottom edges the dot sits, so
 * its centre is on the round photo's edge at 45 degrees, at any avatar size:
 * (1 - 1/√2) / 2 of the box, less half the dot.
 */
const INSET = `calc(14.645% - ${DOT} / 2)`
const BADGE_INSET = `calc(14.645% - ${BADGE} / 2)`
/** The inline dot, as wide as the 13px icon it stands in for, less its side bearings. */
const INLINE_DOT = '8px' // tokens-allow: the inline presence dot
const GLYPH = 10

/**
 * Whether Slack shows you, or the person on a DM row, as active, drawn on
 * the bottom right corner of an avatar, its centre on the photo's edge. The
 * dot is placed against the nearest positioned ancestor, so the owner wraps
 * the avatar alone in a `position: relative` box. Screen readers skip
 * the dot. The owner gives the state in words, as the menu's "Active" line
 * and the button's description do. While notifications are paused a
 * snooze badge takes the dot's place, as Slack shows it: green while
 * active and in the text colour while away, so it still agrees with the
 * words.
 */
export function PresenceDot({ active, surface, paused = false }: PresenceDotProps) {
  if (surface === 'inline') {
    return <span aria-hidden data-presence={active ? 'active' : 'away'} {...stylex.props(styles.inline, active ? styles.active : styles.inlineAway)} />
  }
  if (surface === 'row' || surface === 'rowSelected') {
    return active ? <span aria-hidden data-presence="active" {...stylex.props(styles.dot, rowRings[surface], styles.active)} /> : null
  }
  if (paused) {
    return (
      <span aria-hidden data-paused data-presence={active ? 'active' : 'away'} {...stylex.props(styles.dot, styles.badge, rings[surface], fills[surface], active && styles.badgeActive)}>
        <Snooze />
      </span>
    )
  }
  return <span aria-hidden data-presence={active ? 'active' : 'away'} {...stylex.props(styles.dot, rings[surface], active ? styles.active : holes[surface])} />
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
    right: INSET,
    bottom: INSET,
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
  inline: {
    display: 'inline-block',
    width: INLINE_DOT,
    height: INLINE_DOT,
    flexShrink: 0,
    boxSizing: 'border-box',
    borderRadius: radii['--radius-full'],
  },
  inlineAway: {
    boxShadow: 'inset 0 0 0 1px currentColor', // tokens-allow: The inset ring is a 1px hairline.
  },
  // Away, the glyph takes the text colour; active, the presence green (`badgeActive`).
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    right: BADGE_INSET,
    bottom: BADGE_INSET,
    width: BADGE,
    height: BADGE,
    color: colors['--foreground-default'],
  },
  badgeActive: {
    color: colors['--presence-active'],
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

const rowRings = stylex.create({
  row: { borderColor: colors['--background-subtle'] },
  rowSelected: { borderColor: colors['--secondary-default'] },
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
