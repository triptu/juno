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
  /** Under the pointer, the j's dot gives a small nod. */
  readonly nod?: boolean
  /** Work is running: the dots pulse softly, in place of a spinner, until it ends. Reduced motion shows them still. */
  readonly busy?: boolean
}

/**
 * The Juno mark (`docs/design/logo/concepts/laptop-two/mark.svg`): the
 * seated j, head forward, spine curving into a flat lap, with a laptop as
 * two dots. Drawn in currentColor so it takes the surrounding text colour.
 * Also the assistant's avatar mark at 28.
 */
export function Logo({ size = 24, label, entrance = false, nod = false, busy = false }: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
      {...stylex.props(styles.svg, sizeStyles[size], nod && stylex.defaultMarker())}
    >
      <g {...stylex.props(nod && styles.nod)}>
        <g {...stylex.props(busy && pulse[0])}>
          <circle cx="40" cy="10" r="7" fill="currentColor" {...stylex.props(entrance && gather.head)} />
        </g>
      </g>
      <path
        d="M47.5 25 C47.5 35.5 46 42.5 40.5 46.5 C37.5 48.6 34.5 48.6 31 48.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="8.5"
        strokeLinecap="round"
        {...stylex.props(entrance && gather.spine)}
      />
      <g {...stylex.props(busy && pulse[1])}>
        <circle cx="20" cy="48.6" r="5" fill="currentColor" {...stylex.props(entrance && gather.near)} />
      </g>
      <g {...stylex.props(busy && pulse[2])}>
        <circle cx="10.5" cy="36.5" r="4.5" fill="currentColor" {...stylex.props(entrance && gather.far)} />
      </g>
    </svg>
  )
}

// Where each dot starts before it gathers, in the mark's 64-unit grid: the head from above right, the laptop's dots from the left.
const HEAD_START = 'translate(10px, -14px)' // tokens-allow: the mark's 64-unit grid
const NEAR_START = 'translate(-10px, 12px)' // tokens-allow: the mark's 64-unit grid
const FAR_START = 'translate(-14px, -8px)' // tokens-allow: the mark's 64-unit grid
// The nod: the head dips forward a little.
const NOD = 'translate(-1.5px, 3px)' // tokens-allow: the mark's 64-unit grid
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

// A breath: full, faint, full. It ends where it starts, so reduced motion (one 0.01ms run) shows the mark as it is.
const breathe = stylex.keyframes({
  '0%': { opacity: 1 },
  '50%': { opacity: 0.35 },
  '100%': { opacity: 1 },
})

// The three dots breathe a sixth of a breath apart, head first.
const pulse = stylex.create({
  0: {
    animationName: { default: breathe, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: motion['--duration-pulse'],
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  1: {
    animationName: { default: breathe, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: motion['--duration-pulse'],
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDelay: `calc(${motion['--duration-pulse']} / 6)`,
  },
  2: {
    animationName: { default: breathe, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: motion['--duration-pulse'],
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDelay: `calc(${motion['--duration-pulse']} / 3)`,
  },
})

const styles = stylex.create({
  svg: {
    display: 'block',
    flexShrink: 0,
    color: 'inherit',
    userSelect: 'none',
  },
  // The head dips forward a little, then comes back when the pointer leaves.
  nod: {
    transform: { default: 'none', [stylex.when.ancestor(':hover')]: { default: 'none', '@media (hover: hover) and (prefers-reduced-motion: no-preference)': NOD } },
    transitionProperty: 'transform',
    transitionDuration: motion['--duration-nod'],
    transitionTimingFunction: motion['--ease-out'],
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
