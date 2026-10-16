import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { colors, hues, motion, radii, sizes, weights } from '@juno/tokens/tokens.stylex'
import { tileSizes } from './internal/tileSizes'
import { hueForId, hueNames, type HueName } from './internal/hue'

export { hueForId, hueNames, type HueName }

export type AvatarKind = 'person' | 'group'
export type AvatarSize = 44 | 36 | 32 | 28 | 24 | 20 | 18
/** The surface an avatar ring must cut through: page, sidebar or a card. */
export type AvatarRingSurface = 'background' | 'subtle' | 'surface'

export interface AvatarProps {
  /** People and groups are both round; a group shows two initials. */
  readonly kind?: AvatarKind
  /** The initials to draw, and the fallback while a photo loads or when it fails. */
  readonly label: string
  /** The person's full name, for the accessible name. Omit for decoration. */
  readonly name?: string
  /** 11 is a group member in a tab icon (`GroupAvatar`): no letter fits, so the label should be empty. */
  readonly size?: AvatarSize | 11
  /** Person colour. Use `hueForId` to pick one from a Slack id. */
  readonly hue?: HueName
  /**
   * The Slack profile photo. The box is reserved at `size` before the bytes
   * arrive and the photo fades in over the initials, so nothing moves. If
   * it fails, the initials stay.
   */
  readonly src?: string
  /**
   * A 1.5px ring in the colour of the surface the avatar sits on, so
   * overlapping avatars read as separate. `subtle` is the sidebar.
   */
  readonly ring?: AvatarRingSurface
}

/**
 * A round avatar for a person or a group: the profile photo when there is
 * one, coloured initials otherwise. Colours are mixed from the person's hue
 * so they sit on both themes. Channels are `ChannelIcon`.
 */
export function Avatar({ kind = 'person', label, name, size = 32, hue = 'rose', src, ring }: AvatarProps) {
  // Keyed by src so a row that is reused for another person starts over.
  const [loaded, setLoaded] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState<string | undefined>(undefined)
  const imageSrc = src === undefined || src.startsWith('/') || src.startsWith('data:') || src.startsWith('juno:') ? src : `juno://files/avatar?url=${encodeURIComponent(src)}`
  const showImage = src !== undefined && failed !== src
  const shown = showImage && loaded === src
  return (
    <span
      role={name ? 'img' : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
      data-kind={kind}
      {...stylex.props(styles.base, tileSizes[size], hueStyles[hue], ring && rings[ring])}
    >
      {label}
      {showImage ? (
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
          {...stylex.props(styles.image, shown && styles.imageShown)}
        />
      ) : null}
    </span>
  )
}

const styles = stylex.create({
  base: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: radii['--radius-full'],
    fontWeight: weights['--weight-semibold'],
    lineHeight: 1,
    letterSpacing: 0,
    userSelect: 'none',
    verticalAlign: 'middle',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
  // Sits over the initials in the same box; only opacity changes, and the
  // fade collapses to nothing under reduced motion through the token.
  image: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
  },
  imageShown: {
    opacity: 1,
  },
})

const rings = stylex.create({
  background: { boxShadow: `0 0 0 ${sizes['--avatar-ring']} ${colors['--background']}` },
  subtle: { boxShadow: `0 0 0 ${sizes['--avatar-ring']} ${colors['--background-subtle']}` },
  surface: { boxShadow: `0 0 0 ${sizes['--avatar-ring']} ${colors['--surface-default']}` },
})

// Background: the avatar mix of the hue over the surface. Foreground: the
// hue over the text colour. Written out per hue because StyleX evaluates
// styles statically. ChannelIcon shares this table.
export const hueStyles = stylex.create({
  cyan: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-cyan']} ${hues['--avatar-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-cyan']} ${hues['--avatar-fg-mix']}, ${colors['--foreground-default']})`,
  },
  claret: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-claret']} ${hues['--avatar-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-claret']} ${hues['--avatar-fg-mix']}, ${colors['--foreground-default']})`,
  },
  midnight: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-midnight']} ${hues['--avatar-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-midnight']} ${hues['--avatar-fg-mix']}, ${colors['--foreground-default']})`,
  },
  emeraldDark: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-emerald-dark']} ${hues['--avatar-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-emerald-dark']} ${hues['--avatar-fg-mix']}, ${colors['--foreground-default']})`,
  },
  plum: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-plum']} ${hues['--avatar-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-plum']} ${hues['--avatar-fg-mix']}, ${colors['--foreground-default']})`,
  },
  rose: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-rose']} ${hues['--avatar-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-rose']} ${hues['--avatar-fg-mix']}, ${colors['--foreground-default']})`,
  },
  emerald: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-emerald']} ${hues['--avatar-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-emerald']} ${hues['--avatar-fg-mix']}, ${colors['--foreground-default']})`,
  },
  jordy: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-jordy']} ${hues['--avatar-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-jordy']} ${hues['--avatar-fg-mix']}, ${colors['--foreground-default']})`,
  },
})
