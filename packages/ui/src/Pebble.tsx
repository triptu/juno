import * as stylex from '@stylexjs/stylex'
import { pebbleShape } from '@juno/topic-art'
import { accent, motion } from '@juno/tokens/tokens.stylex'

export interface PebbleProps {
  /** Seeds the shape, the hues and the bands, as a topic id seeds its placeholder. */
  readonly seed: string
  /** Rendered size in px. */
  readonly size: number
  /** Paint the lowest wave band in the accent (`--hl-band`). */
  readonly accentBand?: boolean
  /** Under the pointer, the wave bands drift a little, as water would, and drift back after. */
  readonly ripple?: boolean
}

/**
 * A Tide pebble drawn large, as decoration (the sign-in page's art). The
 * same shape `TopicArt` shows for a topic with no art, drawn as React SVG
 * from `pebbleShape` rather than markup, so each band is its own element.
 * Colours are the Tide tone variables, so it follows the theme.
 */
export function Pebble({ seed, size, accentBand = false, ripple = false }: PebbleProps) {
  'use no memo' // Drawn once per page and never again; the compiler's cache would only add bytes to the sign-in chunk.
  const shape = pebbleShape(seed)
  const last = shape.bands.length - 1
  return (
    <svg viewBox="0 0 40 40" aria-hidden focusable={false} {...stylex.props(styles.svg, styles.size(size), ripple && stylex.defaultMarker())}>
      <defs>
        <clipPath id={shape.clipId}>
          <path d={shape.clip} />
        </clipPath>
      </defs>
      {/* Only the painted, clipped shape takes the pointer, not the square around it. */}
      <g clipPath={`url(#${shape.clipId})`} {...stylex.props(ripple && styles.hit)}>
        <rect width="40" height="40" fill={shape.base} />
        <g transform={`rotate(${shape.tilt} 20 20)`}>
          {shape.bands.map((band, k) => (
            <path key={k} d={band.d} fill={accentBand && k === last ? accent['--hl-band'] : band.fill} {...stylex.props(ripple && driftOf[k % driftOf.length])} />
          ))}
        </g>
        {shape.dot === undefined ? null : <circle cx={shape.dot.cx} cy={shape.dot.cy} r={shape.dot.r} fill={shape.dot.fill} />}
      </g>
    </svg>
  )
}

const styles = stylex.create({
  svg: {
    display: 'block',
    overflow: 'visible',
    userSelect: 'none',
    pointerEvents: 'none',
  },
  hit: {
    pointerEvents: 'visiblePainted',
  },
  size: (px: number) => ({ width: px, height: px }),
})

// Only for a pointer that hovers, and never under reduced motion.
const MOVES = '@media (hover: hover) and (prefers-reduced-motion: no-preference)'
// Each band drifts its own way, in the pebble's 40-unit grid, so the bands slide past each other.
const DRIFT_0 = 'translate(1.4px, -0.4px)' // tokens-allow: the pebble's 40-unit grid
const DRIFT_1 = 'translate(-1.8px, 0.3px)' // tokens-allow: the pebble's 40-unit grid
const DRIFT_2 = 'translate(1px, -0.6px)' // tokens-allow: the pebble's 40-unit grid
const drift = stylex.create({
  0: {
    transform: { default: 'none', [stylex.when.ancestor(':hover')]: { default: 'none', [MOVES]: DRIFT_0 } },
    transitionProperty: 'transform',
    transitionDuration: motion['--duration-drift'],
    transitionTimingFunction: motion['--ease-out'],
  },
  1: {
    transform: { default: 'none', [stylex.when.ancestor(':hover')]: { default: 'none', [MOVES]: DRIFT_1 } },
    transitionProperty: 'transform',
    transitionDuration: motion['--duration-drift'],
    transitionTimingFunction: motion['--ease-out'],
  },
  2: {
    transform: { default: 'none', [stylex.when.ancestor(':hover')]: { default: 'none', [MOVES]: DRIFT_2 } },
    transitionProperty: 'transform',
    transitionDuration: motion['--duration-drift'],
    transitionTimingFunction: motion['--ease-out'],
  },
})
const driftOf = [drift[0], drift[1], drift[2]] as const
