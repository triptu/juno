import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef } from 'react'
import { accent, layout, motion } from '@juno/tokens/tokens.stylex'
import { Pebble } from '@juno/ui'

/** One pebble: its seed, its place in its side's box (left in px, top as a share of a 780px window) and its size in px. */
interface Placement {
  readonly seed: string
  readonly left: number
  readonly top: number
  readonly size: number
  readonly accentBand?: boolean
}

/** The approved mockup's layout (direction a, "Abstract calm"), on a 330 by 780 box per side. */
const ART_HEIGHT = 780
const LEFT: ReadonlyArray<Placement> = [
  { seed: 'signin/a/left/1', left: -120, top: 60, size: 300, accentBand: true },
  { seed: 'signin/a/left/2', left: 90, top: 330, size: 190 },
  { seed: 'signin/a/left/3', left: -60, top: 520, size: 240 },
  { seed: 'signin/a/left/4', left: 150, top: 640, size: 90 },
]
const RIGHT: ReadonlyArray<Placement> = [
  { seed: 'signin/a/right/1', left: 150, top: -40, size: 260 },
  { seed: 'signin/a/right/2', left: 40, top: 250, size: 120 },
  { seed: 'signin/a/right/3', left: 120, top: 420, size: 300, accentBand: true },
  { seed: 'signin/a/right/4', left: 10, top: 660, size: 150 },
]

/** The art's own width: under 1100px it shrinks, under 960px it hides and the column stays centred. */
const SHRINK = '@container sign-in-art (width < 1100px)'
const HIDE = '@container sign-in-art (width < 960px)'

/**
 * The sign-in page's art: large Tide pebbles drifting off both edges, one
 * band per side in the accent, and a faint accent wash behind the title.
 * Placed against the window (the Shell), behind the page's column. It
 * follows the theme and the accent through CSS variables. Decorative.
 */
export function SignInArt() {
  'use no memo' // Rendered once; the compiler's cache would only add bytes to the sign-in chunk.
  const box = useRef<HTMLDivElement>(null)
  useParallax(box)
  return (
    <div ref={box} {...stylex.props(styles.root)} aria-hidden data-sign-in-art="">
      <div {...stylex.props(styles.wash)} />
      <Side placements={LEFT} side="left" />
      <Side placements={RIGHT} side="right" />
    </div>
  )
}

/** The largest pebble moves `MAX_DEPTH` px at most as the pointer crosses the window; smaller ones, further back, move less. */
const LARGEST = 300
const MAX_DEPTH = 8

/**
 * A small parallax: as the pointer moves, each pebble shifts against it by
 * up to its depth. Only a transform, written at most once a frame and only
 * while the pointer moves, so an idle window does no work. Off under
 * reduced motion and while the art is hidden.
 */
function useParallax(box: { readonly current: HTMLDivElement | null }) {
  useEffect(() => {
    const root = box.current
    if (root === null) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const shown = matchMedia('(min-width: 960px)')
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-depth]'), (node) => ({ node, depth: Number(node.dataset['depth']) }))
    let x = 0
    let y = 0
    let frame = 0
    const draw = () => {
      frame = 0
      const dx = x / innerWidth - 0.5
      const dy = y / innerHeight - 0.5
      for (const { node, depth } of items) node.style.transform = `translate3d(${(-dx * depth).toFixed(2)}px, ${(-dy * depth).toFixed(2)}px, 0)`
    }
    const move = (event: PointerEvent) => {
      if (reduced.matches || !shown.matches) return
      x = event.clientX
      y = event.clientY
      if (frame === 0) frame = requestAnimationFrame(draw)
    }
    addEventListener('pointermove', move, { passive: true })
    return () => {
      removeEventListener('pointermove', move)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [box])
}

function Side({ placements, side }: { readonly placements: ReadonlyArray<Placement>; readonly side: 'left' | 'right' }) {
  'use no memo'
  return (
    <div {...stylex.props(styles.side, side === 'left' ? styles.left : styles.right)}>
      {placements.map((p) => (
        <div key={p.seed} data-depth={(p.size / LARGEST) * MAX_DEPTH} {...stylex.props(styles.place(p.left, (p.top / ART_HEIGHT) * 100))}>
          <div {...stylex.props(styles.settle)}>
            <Pebble seed={p.seed} size={p.size} ripple {...(p.accentBand === true ? { accentBand: true } : {})} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Once, on mount: each pebble fades in and settles a few pixels into place.
const settleIn = stylex.keyframes({
  from: { opacity: 0, transform: `translateY(${motion['--rise-settle']})` },
  to: { opacity: 1, transform: 'none' },
})

const styles = stylex.create({
  root: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    containerName: 'sign-in-art',
    containerType: 'inline-size',
  },
  wash: {
    position: 'absolute',
    inset: 0,
    backgroundImage: `radial-gradient(60% 50% at 50% 42%, ${accent['--hl-wash']} 0, transparent 70%)`,
  },
  side: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: layout['--sign-in-art-width'],
    display: { default: 'block', [HIDE]: 'none' },
    transform: { default: 'none', [SHRINK]: 'scale(0.82)' }, // tokens-allow: the mockup's shrink between 960 and 1100px
  },
  left: {
    left: 0,
    transformOrigin: 'left center',
  },
  right: {
    right: 0,
    transformOrigin: 'right center',
  },
  settle: {
    animationName: settleIn,
    animationDuration: motion['--duration-settle'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  place: (left: number, topPercent: number) => ({
    position: 'absolute',
    left,
    top: `${topPercent}%`,
  }),
})
