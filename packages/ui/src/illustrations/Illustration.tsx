import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, sizes } from '@juno/tokens/tokens.stylex'

/**
 * Spot illustrations for empty states, in the language of the seated-j logo
 * and Phosphor regular: one colour through currentColor, stroke 4 on a 104
 * by 72 grid (the same 1/16 ratio as Phosphor regular), round caps and
 * joins, filled dots, and one flat layer in --warm-soft behind part of the
 * drawing. The figure itself is the logo mark at its own weight; it appears
 * in two drawings only, so it stays special.
 */
export type IllustrationName = 'caught-up' | 'nothing-here' | 'nothing-open' | 'no-results' | 'juno'
/** `list` draws 96 wide (sidebar, tables, pickers); `workspace` 120 (no tabs); `figure` 40 (the Juno mark alone). */
export type IllustrationSize = 'list' | 'workspace' | 'figure'

export interface IllustrationProps {
  readonly name: IllustrationName
  readonly size?: IllustrationSize
}

const VIEWBOX = '0 0 104 72'
const STROKE = 4

/** Decorative; the empty state's title says what it means. */
export function Illustration({ name, size = 'list' }: IllustrationProps) {
  const Drawing = drawings[name]
  return (
    <svg viewBox={name === 'juno' ? '0 0 64 64' : VIEWBOX} aria-hidden focusable={false} {...stylex.props(styles.svg, sizeStyles[size])}>
      <Drawing />
    </svg>
  )
}

/** The seated j from the logo: head forward, spine curving into a flat lap. Same geometry as `Logo`. */
function Figure({ x = 0, y = 0 }: { readonly x?: number; readonly y?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="40" cy="10" r="7" fill="currentColor" />
      <path
        d="M47.5 25 C47.5 35.5 46 42.5 40.5 46.5 C37.5 48.6 34.5 48.6 31 48.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="8.5"
        strokeLinecap="round"
      />
    </g>
  )
}

/** A flat layer in the warm tint: the one colour an illustration has besides ink. */
function Warm(props: { readonly children: ReactNode }) {
  return <g {...stylex.props(styles.warm)}>{props.children}</g>
}

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: STROKE, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** The seated j with a tablet on its lap, tilted toward the reader, a check on the screen. */
function CaughtUp() {
  return (
    <>
      <Figure x={22} y={3} />
      <g transform="rotate(-8 30 45)">
        <Warm>
          <rect x="10" y="32" width="42" height="27" rx="5" />
        </Warm>
        <rect x="10" y="32" width="42" height="27" rx="5" {...line} />
        <path d="M23.5 46 L29 51.5 L39.5 40" {...line} />
      </g>
    </>
  )
}

/** A tray with two faded rows resting in it. */
function NothingHere() {
  return (
    <>
      <Warm>
        <path d="M22 40 V54 a6 6 0 0 0 6 6 H76 a6 6 0 0 0 6 -6 V40 Z" />
      </Warm>
      <path d="M22 30 V54 a6 6 0 0 0 6 6 H76 a6 6 0 0 0 6 -6 V30" {...line} />
      <path d="M22 40 H36 L41 47 H63 L68 40 H82" {...line} />
      <path d="M36 22 H68" {...line} opacity="0.5" />
      <path d="M42 12 H62" {...line} opacity="0.25" />
    </>
  )
}

/** A tablet on its own, blank, with the j's two reply dots beside it. */
function NothingOpen() {
  return (
    <>
      <g transform="rotate(-6 40 40)">
        <Warm>
          <rect x="18" y="24" width="44" height="30" rx="5" />
        </Warm>
        <rect x="18" y="24" width="44" height="30" rx="5" {...line} />
      </g>
      <circle cx="76" cy="52" r="4.5" fill="currentColor" />
      <circle cx="88" cy="42" r="4" fill="currentColor" />
    </>
  )
}

/** A magnifying glass over two short rows. */
function NoResults() {
  return (
    <>
      <path d="M16 54 H46" {...line} opacity="0.5" />
      <path d="M16 64 H36" {...line} opacity="0.25" />
      <Warm>
        <circle cx="52" cy="30" r="15" />
      </Warm>
      <circle cx="52" cy="30" r="15" {...line} />
      <path d="M63 41 L78 56" {...line} />
    </>
  )
}

/** The seated j alone, on a warm disc. */
function Juno() {
  return (
    <>
      <Warm>
        <circle cx="33" cy="36" r="23" />
      </Warm>
      <Figure />
    </>
  )
}

const drawings: Record<IllustrationName, () => ReactNode> = {
  'caught-up': CaughtUp,
  'nothing-here': NothingHere,
  'nothing-open': NothingOpen,
  'no-results': NoResults,
  juno: Juno,
}

const styles = stylex.create({
  svg: {
    display: 'block',
    height: 'auto',
    flexShrink: 0,
    color: colors['--foreground-subtle'],
    userSelect: 'none',
  },
  warm: {
    fill: colors['--warm-soft'],
  },
})

const sizeStyles = stylex.create({
  list: { width: sizes['--illustration-list'] },
  workspace: { width: sizes['--illustration-workspace'] },
  figure: { width: sizes['--illustration-figure'] },
})
