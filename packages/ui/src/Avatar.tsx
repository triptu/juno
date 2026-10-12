import * as stylex from '@stylexjs/stylex'
import { colors, hues, radii, sizes, weights } from '@juno/tokens/tokens.stylex'

export type AvatarKind = 'person' | 'channel' | 'group'
export type AvatarSize = 44 | 36 | 32 | 28 | 24 | 20 | 18
export type HueName = 'cyan' | 'claret' | 'midnight' | 'emeraldDark' | 'plum' | 'rose' | 'emerald' | 'jordy'
/** The surface an avatar ring must cut through: page, sidebar or a card. */
export type AvatarRingSurface = 'background' | 'subtle' | 'surface'

export const hueNames: ReadonlyArray<HueName> = [
  'cyan',
  'claret',
  'midnight',
  'emeraldDark',
  'plum',
  'rose',
  'emerald',
  'jordy',
]

export interface AvatarProps {
  /** Channel tiles are square with one letter; people and groups are round. */
  readonly kind?: AvatarKind
  /** The letter or initials to draw. */
  readonly label: string
  /** The person's full name, for the accessible name. Omit for decoration. */
  readonly name?: string
  readonly size?: AvatarSize
  /** Person colour. Ignored for channels. */
  readonly hue?: HueName
  /**
   * A 1.5px ring in the colour of the surface the avatar sits on, so
   * overlapping avatars read as separate. `subtle` is the sidebar.
   */
  readonly ring?: AvatarRingSurface
}

/**
 * A square tile for a channel or a round avatar for a person. Colours are
 * mixed from the person's hue so they sit on both themes.
 */
export function Avatar({ kind = 'person', label, name, size = 32, hue = 'rose', ring }: AvatarProps) {
  return (
    <span
      role={name ? 'img' : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
      {...stylex.props(
        styles.base,
        sizeStyles[size],
        kind === 'channel' ? styles.channel : styles.person,
        kind === 'channel' && tileRadius[size],
        kind !== 'channel' && hueStyles[hue],
        ring && rings[ring],
      )}
    >
      {label}
    </span>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontWeight: weights['--weight-semibold'],
    lineHeight: 1,
    letterSpacing: 0,
    userSelect: 'none',
    verticalAlign: 'middle',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
  channel: {
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-subtle'],
    textTransform: 'uppercase',
  },
  person: {
    borderRadius: radii['--radius-full'],
  },
})

const rings = stylex.create({
  background: { boxShadow: `0 0 0 ${sizes['--avatar-ring']} ${colors['--background']}` },
  subtle: { boxShadow: `0 0 0 ${sizes['--avatar-ring']} ${colors['--background-subtle']}` },
  surface: { boxShadow: `0 0 0 ${sizes['--avatar-ring']} ${colors['--surface-default']}` },
})

const sizeStyles = stylex.create({
  44: { width: sizes['--tile-44'], height: sizes['--tile-44'], fontSize: sizes['--initials-44'] },
  36: { width: sizes['--tile-36'], height: sizes['--tile-36'], fontSize: sizes['--initials-36'] },
  32: { width: sizes['--avatar-32'], height: sizes['--avatar-32'], fontSize: sizes['--initials-32'] },
  28: { width: sizes['--avatar-28'], height: sizes['--avatar-28'], fontSize: sizes['--initials-28'] },
  24: { width: sizes['--avatar-24'], height: sizes['--avatar-24'], fontSize: sizes['--initials-24'] },
  20: { width: sizes['--avatar-20'], height: sizes['--avatar-20'], fontSize: sizes['--initials-20'] },
  18: { width: sizes['--avatar-18'], height: sizes['--avatar-18'], fontSize: sizes['--initials-18'] },
})

// Tile radius follows the nesting rule against the row it sits in.
const tileRadius = stylex.create({
  44: { borderRadius: radii['--radius-xl'] },
  36: { borderRadius: radii['--radius-lg'] },
  32: { borderRadius: radii['--radius-lg'] },
  28: { borderRadius: radii['--radius-md-plus'] },
  24: { borderRadius: radii['--radius-md'] },
  20: { borderRadius: radii['--radius-sm'] },
  18: { borderRadius: radii['--radius-sm'] },
})

// Background: 24% of the hue over the surface. Foreground: 62% over the text
// colour. Written out per hue because StyleX evaluates styles statically.
const hueStyles = stylex.create({
  cyan: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-cyan']} 24%, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-cyan']} 62%, ${colors['--foreground-default']})`,
  },
  claret: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-claret']} 24%, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-claret']} 62%, ${colors['--foreground-default']})`,
  },
  midnight: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-midnight']} 24%, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-midnight']} 62%, ${colors['--foreground-default']})`,
  },
  emeraldDark: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-emerald-dark']} 24%, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-emerald-dark']} 62%, ${colors['--foreground-default']})`,
  },
  plum: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-plum']} 24%, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-plum']} 62%, ${colors['--foreground-default']})`,
  },
  rose: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-rose']} 24%, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-rose']} 62%, ${colors['--foreground-default']})`,
  },
  emerald: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-emerald']} 24%, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-emerald']} 62%, ${colors['--foreground-default']})`,
  },
  jordy: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-jordy']} 24%, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-jordy']} 62%, ${colors['--foreground-default']})`,
  },
})
