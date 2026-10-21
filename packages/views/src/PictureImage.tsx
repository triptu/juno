import * as stylex from '@stylexjs/stylex'
import { colors, radii, shadows } from '@juno/tokens/tokens.stylex'

/** What a picture's tile, caption and page need (`@juno/pictures`'s `Picture` has these fields). */
export interface PictureCardView {
  readonly id: string
  readonly kind: 'painting' | 'print' | 'illustration' | 'space'
  readonly title: string
  readonly artist: string
  readonly date: string
  /** Width over height: the box takes the picture's shape before it loads. */
  readonly ratio: number
}

export interface PictureImageProps {
  /** The local file; undefined until it is on this Mac, when the box shows the secondary fill at the picture's shape. */
  readonly src: string | undefined
  readonly ratio: number
  /** The file would not load. */
  readonly onError?: () => void
}

/**
 * A picture on the page (SPEC 12, "Pictures and the gallery"): its box at
 * the picture's shape, a thin edge drawn over it and a soft shadow under
 * it, as a print hung on a wall. The owner sets the width; the height
 * follows the ratio, so the box never changes when the file lands.
 * Decorative: the owner's button or heading names it.
 */
export function PictureImage({ src, ratio, onError }: PictureImageProps) {
  return (
    <span data-picture-image="" {...stylex.props(styles.box, styles.shape(ratio))}>
      {src === undefined ? null : <img src={src} alt="" draggable={false} decoding="async" onError={onError} {...stylex.props(styles.image)} />}
    </span>
  )
}

const HOVER = '@media (hover: hover)'

const lift = stylex.create({
  owner: {
    '--picture-lift': {
      default: shadows['--shadow-lg'],
      ':hover': { default: null, [HOVER]: shadows['--pop-shadow'] },
      ':focus-visible': shadows['--pop-shadow'],
    },
  },
})

/** On a button or link that holds a `PictureImage`: its picture's shadow deepens under the pointer and on keyboard focus. */
export const pictureLift = lift.owner

const styles = stylex.create({
  box: {
    position: 'relative',
    display: 'block',
    width: '100%',
    overflow: 'hidden',
    borderRadius: radii['--radius-inline'],
    backgroundColor: colors['--secondary-default'],
    // An owner that opens something deepens it under the pointer by setting `--picture-lift` (`pictureLift`).
    boxShadow: `var(--picture-lift, ${shadows['--shadow-lg']})`,
    // The edge sits over the picture, so a pale painting or a dark space image keeps it.
    '::after': {
      content: "''",
      position: 'absolute',
      inset: 0,
      borderRadius: 'inherit',
      boxShadow: shadows['--picture-edge'],
      pointerEvents: 'none',
    },
  },
  shape: (ratio: number) => ({ aspectRatio: ratio }),
  image: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
})
