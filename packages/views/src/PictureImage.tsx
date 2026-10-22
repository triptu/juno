import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { colors, radii, shadows } from '@juno/tokens/tokens.stylex'

/** What a picture's tile, caption and page need (`@juno/pictures`'s `Picture` has these fields). */
export interface PictureCardView {
  readonly id: string
  readonly kind: 'painting' | 'print' | 'illustration' | 'space' | 'objects'
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
  /** What the picture shows, for screen readers, where nothing else names it (the picture page). Else decorative. */
  readonly alt?: string
  /** The file would not load. */
  readonly onError?: () => void
}

/**
 * A picture on the page (SPEC 12, "Pictures and the gallery"): its box at
 * the picture's shape, a thin edge drawn over it and a soft shadow under
 * it, as a print hung on a wall. The owner sets the width; the height
 * follows the ratio, so the box never changes when the file lands.
 * Decorative: the owner's button or heading names it.
 *
 * A new `src` (the large file after the small one) waits hidden over the
 * file in front until it is decoded, then takes its place in one frame, so
 * the picture only gets sharper: no blank frame and no fade.
 */
export function PictureImage({ src, ratio, alt = '', onError }: PictureImageProps) {
  const [front, setFront] = useState(src)
  if (front === undefined && src !== undefined) setFront(src)
  const back = front !== undefined && src !== front ? src : undefined
  // Once decoded, the file moves to the front, unless a newer one replaced it meanwhile.
  const reveal = (image: HTMLImageElement, file: string) => {
    void image.decode().then(() => {
      if (image.isConnected) setFront(file)
    }, () => undefined)
  }
  return (
    <span data-picture-image="" {...stylex.props(styles.box, styles.shape(ratio))}>
      {front === undefined ? null : <img key={front} src={front} alt={alt} draggable={false} decoding="async" onError={onError} {...stylex.props(styles.image)} />}
      {back === undefined ? null : <img key={back} src={back} alt="" draggable={false} decoding="async" onLoad={(event) => reveal(event.currentTarget, back)} {...stylex.props(styles.image, styles.waiting)} />}
    </span>
  )
}

/**
 * The small files of the pictures that may show next (the picture page's
 * ← and →), loaded and decoded now, so the next page paints its picture in
 * its first frame. Draws nothing.
 */
export function PicturesAhead({ srcs }: { readonly srcs: ReadonlyArray<string> }) {
  return (
    <span hidden>
      {srcs.map((src) => (
        <img key={src} src={src} alt="" ref={decodeNow} />
      ))}
    </span>
  )
}

const decodeNow = (image: HTMLImageElement | null) => {
  void image?.decode().catch(() => undefined)
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

const homeLift = stylex.create({
  owner: {
    '--picture-rim': shadows['--picture-home-edge'],
    '--picture-lift': {
      default: shadows['--picture-home-shadow'],
      ':hover': { default: null, [HOVER]: shadows['--picture-home-shadow-hover'] },
      ':focus-visible': shadows['--picture-home-shadow-hover'],
    },
  },
})

/** Home's picture: lifted off the page with a firmer edge and a deeper shadow, deeper still under the pointer. */
export const homePictureLift = homeLift.owner

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
      // Home's picture sets a firmer edge (`homePictureLift`).
      boxShadow: `var(--picture-rim, ${shadows['--picture-edge']})`,
      pointerEvents: 'none',
    },
  },
  shape: (ratio: number) => ({ aspectRatio: ratio }),
  // Stacked in the box, so a file waiting to be decoded lies over the one in front.
  image: {
    position: 'absolute',
    inset: 0,
    display: 'block',
    width: '100%',
    height: '100%',
    // The file has the box's shape, so the whole picture shows.
    objectFit: 'cover',
  },
  waiting: { visibility: 'hidden' },
})
