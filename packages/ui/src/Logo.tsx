import * as stylex from '@stylexjs/stylex'
import { motion, sizes } from '@juno/tokens/tokens.stylex'

export type LogoSize = 16 | 18 | 20 | 24 | 28 | 32 | 40 | 44

export interface LogoProps {
  /** Rendered size in px. Default 24. */
  readonly size?: LogoSize
  /** Accessible name ("Juno"). Omit when the mark is decorative. */
  readonly label?: string
  /** On mount, the dots gather into the j once (the sign-in page). Reduced motion shows it in place. */
  readonly entrance?: boolean
}

/**
 * The Juno mark (`docs/design/logo/concepts/laptop-two/mark.svg`): the
 * seated j, head forward, spine curving into a flat lap, with a laptop as
 * two dots. Drawn in currentColor so it takes the surrounding text colour.
 * Also the assistant's avatar mark at 28.
 */
export function Logo({ size = 24, label, entrance = false }: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
      {...stylex.props(styles.svg, sizeStyles[size])}
    >
      <circle cx="40" cy="10" r="7" fill="currentColor" {...stylex.props(entrance && gather.head)} />
      <path
        d="M47.5 25 C47.5 35.5 46 42.5 40.5 46.5 C37.5 48.6 34.5 48.6 31 48.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="8.5"
        strokeLinecap="round"
        {...stylex.props(entrance && gather.spine)}
      />
      <circle cx="20" cy="48.6" r="5" fill="currentColor" {...stylex.props(entrance && gather.near)} />
      <circle cx="10.5" cy="36.5" r="4.5" fill="currentColor" {...stylex.props(entrance && gather.far)} />
    </svg>
  )
}

// Where each dot starts before it gathers, in the mark's 64-unit grid: the head from above right, the laptop's dots from the left.
const HEAD_START = 'translate(10px, -14px)' // tokens-allow: the mark's 64-unit grid
const NEAR_START = 'translate(-10px, 12px)' // tokens-allow: the mark's 64-unit grid
const FAR_START = 'translate(-14px, -8px)' // tokens-allow: the mark's 64-unit grid
const fromHead = stylex.keyframes({
  from: { opacity: 0, transform: HEAD_START },
  to: { opacity: 1, transform: 'none' },
})
const fromNear = stylex.keyframes({
  from: { opacity: 0, transform: NEAR_START },
  to: { opacity: 1, transform: 'none' },
})
const fromFar = stylex.keyframes({
  from: { opacity: 0, transform: FAR_START },
  to: { opacity: 1, transform: 'none' },
})
const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const gather = stylex.create({
  head: {
    animationName: fromHead,
    animationDuration: motion['--duration-gather'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  near: {
    animationName: fromNear,
    animationDuration: motion['--duration-gather'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  far: {
    animationName: fromFar,
    animationDuration: motion['--duration-gather'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  spine: {
    animationName: fadeIn,
    animationDuration: motion['--duration-gather'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
})

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
