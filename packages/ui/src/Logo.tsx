import * as stylex from '@stylexjs/stylex'
import { sizes } from '@juno/tokens/tokens.stylex'

export type LogoSize = 16 | 18 | 20 | 24 | 28 | 32 | 40 | 44

export interface LogoProps {
  /** Rendered size in px. Default 24. */
  readonly size?: LogoSize
  /** Accessible name ("Juno"). Omit when the mark is decorative. */
  readonly label?: string
}

/**
 * The Juno mark (`docs/design/logo/concepts/laptop-two/mark.svg`): the
 * seated j, head forward, spine curving into a flat lap, with a laptop as
 * two dots. Drawn in currentColor so it takes the surrounding text colour.
 * Also the assistant's avatar mark at 28.
 */
export function Logo({ size = 24, label }: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
      {...stylex.props(styles.svg, sizeStyles[size])}
    >
      <circle cx="40" cy="10" r="7" fill="currentColor" />
      <path
        d="M47.5 25 C47.5 35.5 46 42.5 40.5 46.5 C37.5 48.6 34.5 48.6 31 48.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="8.5"
        strokeLinecap="round"
      />
      <circle cx="20" cy="48.6" r="5" fill="currentColor" />
      <circle cx="10.5" cy="36.5" r="4.5" fill="currentColor" />
    </svg>
  )
}

const styles = stylex.create({
  svg: {
    display: 'block',
    flexShrink: 0,
    color: 'inherit',
    userSelect: 'none',
  },
})

const sizeStyles = stylex.create({
  16: { width: sizes['--icon-16'], height: sizes['--icon-16'] },
  18: { width: sizes['--icon-18'], height: sizes['--icon-18'] },
  20: { width: sizes['--icon-20'], height: sizes['--icon-20'] },
  24: { width: sizes['--avatar-24'], height: sizes['--avatar-24'] },
  28: { width: sizes['--avatar-28'], height: sizes['--avatar-28'] },
  32: { width: sizes['--avatar-32'], height: sizes['--avatar-32'] },
  40: { width: sizes['--illustration-figure'], height: sizes['--illustration-figure'] },
  44: { width: sizes['--tile-44'], height: sizes['--tile-44'] },
})
