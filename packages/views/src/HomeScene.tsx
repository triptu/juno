import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, sizes } from '@juno/tokens/tokens.stylex'

/**
 * Home's scenes (`docs/design/home/scenes.png`): the logo's seated j at a
 * table, in three postures, with props for the time of day, Friday, the
 * season and caught up. The illustration grid: 104 by 72, stroke 4 with
 * round caps, one flat layer in `--warm-soft`, everything else
 * `currentColor` in `--foreground-subtle`, so one drawing serves both
 * themes. Decorative: the greeting carries the meaning.
 */
export type HomeSceneName = 'morning' | 'midday' | 'evening' | 'night' | 'friday' | 'winter' | 'autumn' | 'caughtUp'

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function Warm(props: { readonly children: ReactNode }) {
  return <g {...stylex.props(styles.warm)}>{props.children}</g>
}

/** The figure: upright (the logo), leaning back, or sunk back. */
function Figure({ posture }: { readonly posture: 'up' | 'lean' | 'sink' }) {
  const shape = {
    up: { head: [40, 10], spine: 'M47.5 25 C47.5 35.5 46 42.5 40.5 46.5 C37.5 48.6 34.5 48.6 31 48.6' },
    lean: { head: [46.5, 12.5], spine: 'M53.5 27.5 C53.5 37.5 50.5 43.5 43.5 47 C40 48.6 35 48.6 27 48.6' },
    sink: { head: [50, 16], spine: 'M57 31 C57 40 54 45 46 47.6 C42 48.6 36 48.6 25 48.6' },
  }[posture]
  return (
    <>
      <circle cx={shape.head[0]} cy={shape.head[1]} r="7" fill="currentColor" />
      <path d={shape.spine} fill="none" stroke="currentColor" strokeWidth="8.5" strokeLinecap="round" />
    </>
  )
}

/** The logo's laptop as two dots: open has one up, closed has both on the table. */
function Laptop({ open }: { readonly open: boolean }) {
  return (
    <>
      <circle cx="20" cy="48.6" r="5" fill="currentColor" />
      {open ? <circle cx="10.5" cy="36.5" r="4.5" fill="currentColor" /> : <circle cx="8" cy="48.6" r="4.5" fill="currentColor" />}
    </>
  )
}

function Mug() {
  return (
    <g transform="translate(21 8)">
      <Warm>
        <rect x="6" y="36" width="16" height="12.6" rx="3" />
      </Warm>
      <path d="M6 39 H18 M6 36 H22 V45.6 A3 3 0 0 1 19 48.6 H9 A3 3 0 0 1 6 45.6 Z" {...line} />
      <path d="M22 39 C27.5 39 27.5 46.5 22 46.5" {...line} />
      <path d="M10.5 30 C8 27.5 13 25.5 10.5 22.5" {...line} opacity="0.4" />
      <path d="M17.5 30 C14.5 26.5 20.5 24.5 17.5 19.5" {...line} opacity="0.4" />
    </g>
  )
}

/** The figure at the table, offset as in the mock. */
function AtTable({ posture, laptop }: { readonly posture: 'up' | 'lean' | 'sink'; readonly laptop?: 'open' | 'closed' }) {
  return (
    <g transform="translate(26 8)">
      <Figure posture={posture} />
      {laptop === undefined ? null : <Laptop open={laptop === 'open'} />}
    </g>
  )
}

const scenes: Record<HomeSceneName, () => ReactNode> = {
  morning: () => (
    <>
      <AtTable posture="up" />
      <Mug />
    </>
  ),
  midday: () => (
    <>
      <Warm>
        <circle cx="22" cy="18" r="9" />
      </Warm>
      <circle cx="22" cy="18" r="9" {...line} />
      <AtTable posture="up" laptop="open" />
    </>
  ),
  evening: () => (
    <>
      <Warm>
        <path d="M1 56.6 A13 13 0 0 1 27 56.6 Z" />
      </Warm>
      <path d="M2 56.6 H28" {...line} />
      <AtTable posture="lean" laptop="closed" />
    </>
  ),
  night: () => (
    <>
      <Warm>
        <path d="M24 10 A12 12 0 1 0 36 27 A9.5 9.5 0 0 1 24 10 Z" />
      </Warm>
      <path d="M24 10 A12 12 0 1 0 36 27 A9.5 9.5 0 0 1 24 10 Z" {...line} />
      <AtTable posture="up" laptop="open" />
    </>
  ),
  friday: () => (
    <>
      <AtTable posture="up" laptop="open" />
      <Warm>
        <path d="M8 46 H26 L23.5 56.6 H10.5 Z" />
      </Warm>
      <path d="M8 46 H26 L23.5 56.6 H10.5 Z" {...line} />
      <path d="M17 46 V34" {...line} />
      <path d="M17 40 C12 40 9 37 8.5 32 C13.5 32 17 35 17 40 Z" {...line} />
      <path d="M17 36 C22 36 25 33 25.5 28 C20.5 28 17 31 17 36 Z" {...line} />
    </>
  ),
  winter: () => (
    <>
      <AtTable posture="up" />
      <Mug />
      <path d="M16 9 V27 M8.2 13.5 L23.8 22.5 M8.2 22.5 L23.8 13.5" {...line} strokeWidth="3" opacity="0.55" />
    </>
  ),
  autumn: () => (
    <>
      <AtTable posture="up" laptop="open" />
      <g transform="rotate(20 18 22)">
        <Warm>
          <path d="M8 32 C8 20 18 12 30 12 C30 24 20 32 8 32 Z" />
        </Warm>
        <path d="M8 32 C8 20 18 12 30 12 C30 24 20 32 8 32 Z" {...line} />
        <path d="M11 29 L24 16" {...line} />
      </g>
    </>
  ),
  caughtUp: () => (
    <>
      <Warm>
        <rect x="50" y="43" width="48" height="22" rx="11" />
      </Warm>
      <AtTable posture="sink" />
      <g transform="translate(4 8)">
        <Laptop open={false} />
      </g>
    </>
  ),
}

export function HomeScene({ name }: { readonly name: HomeSceneName }) {
  const Drawing = scenes[name]
  return (
    <svg viewBox="0 0 104 72" aria-hidden focusable={false} data-home-scene={name} {...stylex.props(styles.svg)}>
      <Drawing />
    </svg>
  )
}

const styles = stylex.create({
  svg: {
    display: 'block',
    flexShrink: 0,
    width: sizes['--illustration-workspace'],
    // The drawing grid's own ratio: 120 by 83.
    aspectRatio: '104 / 72',
    color: colors['--foreground-subtle'],
  },
  warm: {
    fill: colors['--warm-soft'],
  },
})
