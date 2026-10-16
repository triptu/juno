import * as stylex from '@stylexjs/stylex'
import { accent, colors, sizes } from '@juno/tokens/tokens.stylex'

export type ProgressRingSize = 16 | 20

export interface ProgressRingProps {
  /** How much is done, out of `max`. Absent while the total is not known yet: the ring shows its empty track. */
  readonly value?: number
  readonly max?: number
  /** Rendered size in px. Default 20. */
  readonly size?: ProgressRingSize
  /** Accessible name of the progressbar ("Sync progress"). */
  readonly label: string
  /** What a screen reader says for the value ("11 of 148 conversations"). */
  readonly valueText?: string
}

// The ring is drawn on a 20-unit grid: a 2.5 stroke is 2px at 16 and 2.5px at 20.
const VIEW = 20
const STROKE = 2.5
const RADIUS = (VIEW - STROKE) / 2

/**
 * A determinate progress ring, as macOS draws one for a download: a quiet
 * track and an accent arc from twelve o'clock. Without a total it shows the
 * track only. The arc does not animate; each update repaints it.
 */
export function ProgressRing({ value, max, size = 20, label, valueText }: ProgressRingProps) {
  const known = value !== undefined && max !== undefined && max > 0
  const percent = known ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={known ? max : undefined}
      aria-valuenow={known ? value : undefined}
      aria-valuetext={valueText}
      focusable={false}
      {...stylex.props(styles.svg, sizeStyles[size])}
    >
      <circle cx={VIEW / 2} cy={VIEW / 2} r={RADIUS} fill="none" strokeWidth={STROKE} {...stylex.props(styles.track)} />
      {percent > 0 ? (
        <circle
          cx={VIEW / 2}
          cy={VIEW / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${percent} 100`}
          transform={`rotate(-90 ${VIEW / 2} ${VIEW / 2})`}
          {...stylex.props(styles.arc)}
        />
      ) : null}
    </svg>
  )
}

const styles = stylex.create({
  svg: {
    display: 'block',
    flexShrink: 0,
  },
  track: { stroke: colors['--border-strongest'] },
  arc: { stroke: accent['--hl'] },
})

const sizeStyles = stylex.create({
  16: { width: sizes['--icon-16'], height: sizes['--icon-16'] },
  20: { width: sizes['--icon-20'], height: sizes['--icon-20'] },
})
