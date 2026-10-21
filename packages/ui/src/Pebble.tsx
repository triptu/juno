import * as stylex from '@stylexjs/stylex'
import { pebbleShape } from '@juno/topic-art'
import { accent } from '@juno/tokens/tokens.stylex'

export interface PebbleProps {
  /** Seeds the shape, the hues and the bands, as a topic id seeds its placeholder. */
  readonly seed: string
  /** Rendered size in px. */
  readonly size: number
  /** Paint the lowest wave band in the accent (`--hl-band`). */
  readonly accentBand?: boolean
}

/**
 * A Tide pebble drawn large, as decoration (the sign-in page's art). The
 * same shape `TopicArt` shows for a topic with no art, drawn as React SVG
 * from `pebbleShape` rather than markup, so each band is its own element.
 * Colours are the Tide tone variables, so it follows the theme.
 */
export function Pebble({ seed, size, accentBand = false }: PebbleProps) {
  const shape = pebbleShape(seed)
  const last = shape.bands.length - 1
  return (
    <svg viewBox="0 0 40 40" aria-hidden focusable={false} {...stylex.props(styles.svg, styles.size(size))}>
      <defs>
        <clipPath id={shape.clipId}>
          <path d={shape.clip} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${shape.clipId})`}>
        <rect width="40" height="40" fill={shape.base} />
        <g transform={`rotate(${shape.tilt} 20 20)`}>
          {shape.bands.map((band, k) => (
            <path key={k} d={band.d} fill={accentBand && k === last ? accent['--hl-band'] : band.fill} />
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
  },
  size: (px: number) => ({ width: px, height: px }),
})
