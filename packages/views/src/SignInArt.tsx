import * as stylex from '@stylexjs/stylex'
import { accent, layout } from '@juno/tokens/tokens.stylex'
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
  return (
    <div {...stylex.props(styles.root)} aria-hidden data-sign-in-art="">
      <div {...stylex.props(styles.wash)} />
      <Side placements={LEFT} side="left" />
      <Side placements={RIGHT} side="right" />
    </div>
  )
}

function Side({ placements, side }: { readonly placements: ReadonlyArray<Placement>; readonly side: 'left' | 'right' }) {
  return (
    <div {...stylex.props(styles.side, side === 'left' ? styles.left : styles.right)}>
      {placements.map((p) => (
        <div key={p.seed} {...stylex.props(styles.place(p.left, (p.top / ART_HEIGHT) * 100))}>
          <Pebble seed={p.seed} size={p.size} {...(p.accentBand === true ? { accentBand: true } : {})} />
        </div>
      ))}
    </div>
  )
}

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
  place: (left: number, topPercent: number) => ({
    position: 'absolute',
    left,
    top: `${topPercent}%`,
  }),
})
