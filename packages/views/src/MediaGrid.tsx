/**
 * A message's images and videos as the message shows them: one picture at
 * its box, or a grid of tiles (`MediaGrid`). Split from `FileCard.tsx`,
 * which places them among the file cards.
 */
import * as stylex from '@stylexjs/stylex'
import { Image } from '@phosphor-icons/react/dist/icons/Image'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { useState } from 'react'
import type { FileThumb, FileView } from '@juno/contract'
import { accent, colors, layout, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, Text } from '@juno/ui'

/** Tiles a message's grid shows; the last says "+N" for the rest. */
const GRID_TILES = 4

/** A file the media viewer shows: an image or a video with a picture to show for it. */
export type MediaFile = FileView & { readonly thumb: FileThumb }

export const isMedia = (file: FileView): file is MediaFile => file.thumb !== undefined && (file.kind === 'image' || file.kind === 'video')

/** A message's images and videos, in Slack's order: what its grid and the viewer's filmstrip show. */
export const mediaOf = (files: ReadonlyArray<FileView>): ReadonlyArray<MediaFile> => files.filter(isMedia)
export interface MediaGridProps {
  readonly media: ReadonlyArray<MediaFile>
  readonly onOpen: ((file: FileView) => void) | undefined
  readonly tabIndex: number
}

/** A message's images and videos: the lone picture, or the grid. Tiles are keyed by place, so a sent file whose id changes keeps its image. */
export function MediaGrid({ media, onOpen, tabIndex }: MediaGridProps) {
  if (media.length === 1) return <Thumbnail key="thumb:0" file={media[0]!} thumb={media[0]!.thumb} onOpen={onOpen} tabIndex={tabIndex} />
  const shown = media.slice(0, GRID_TILES)
  const more = media.length - shown.length
  return (
    <div
      data-thumbnail-grid=""
      data-count={media.length}
      {...stylex.props(styles.grid, media.length === 2 ? styles.gridTwo : styles.gridFour)}
    >
      {shown.map((file, index) => (
        <Thumbnail
          key={`thumb:${index}`}
          file={file}
          thumb={file.thumb}
          onOpen={onOpen}
          tabIndex={tabIndex}
          tile
          tall={media.length === 3 && index === 0}
          more={index === shown.length - 1 && more > 0 ? more : undefined}
        />
      ))}
    </div>
  )
}

// The thumbnail's caps, as numbers for the size arithmetic below. They
// repeat --thumb-max-width and --thumb-max-height.
const THUMB_MAX_WIDTH = 360
const THUMB_MAX_HEIGHT = 240

/** The box an image gets, from its own dimensions and the caps, before any bytes arrive. */
export function thumbnailBox(width = THUMB_MAX_WIDTH, height = THUMB_MAX_HEIGHT): { readonly width: number; readonly height: number } {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const scale = Math.min(1, THUMB_MAX_WIDTH / safeWidth, THUMB_MAX_HEIGHT / safeHeight)
  return { width: Math.round(safeWidth * scale), height: Math.round(safeHeight * scale) }
}

interface ThumbnailProps {
  readonly file: FileView
  readonly thumb: FileThumb
  readonly onOpen: ((file: FileView) => void) | undefined
  readonly tabIndex: number
  /** A cell of a grid of images: the grid sizes the box, and the image fills it. */
  readonly tile?: boolean
  /** The first of three tiles takes the grid's left column. */
  readonly tall?: boolean
  /** The last tile of a grid with more pictures than tiles: "+N" over it. */
  readonly more?: number | undefined
}

/** With `onOpen` the box is a button with the same look; Enter and Space open it too. */
function Thumbnail({ file, thumb, onOpen, tabIndex, tile = false, tall = false, more }: ThumbnailProps) {
  const [loaded, setLoaded] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState<string | undefined>(undefined)
  const box = thumbnailBox(thumb.width, thumb.height)
  const broken = failed === thumb.src
  const sx = stylex.props(styles.thumb, tile ? styles.tile : styles.box(box.width, box.height, thumb.width, thumb.height), tall && styles.tall, onOpen !== undefined && styles.thumbButton)
  const label = more === undefined ? file.name : `${file.name}, and ${more} more`
  // While a new src loads (the staged image giving way to Slack's), the one already shown stays under it.
  const previous = loaded !== undefined && loaded !== thumb.src ? loaded : undefined
  const content = broken ? (
    <span {...stylex.props(styles.brokenGlyph)}>
      <Icon icon={Image} size={18} />
    </span>
  ) : (
    <>
      {previous === undefined ? null : <img src={previous} alt="" draggable={false} decoding="async" {...stylex.props(styles.image, styles.imageShown)} />}
      <img
        src={thumb.src}
        alt=""
        draggable={false}
        decoding="async"
        loading="lazy"
        onLoad={() => setLoaded(thumb.src)}
        onError={() => setFailed(thumb.src)}
        {...stylex.props(styles.image, loaded === thumb.src && styles.imageShown)}
      />
      {file.kind === 'video' && more === undefined ? (
        <span {...stylex.props(styles.playBadge)}>
          <Icon icon={Play} size={14} weight="fill" />
        </span>
      ) : null}
      {more === undefined ? null : (
        <span data-more="" {...stylex.props(styles.moreScrim)}>
          <Text variant="heading" weight="medium" tone="inherit" numeric>{`+${more}`}</Text>
        </span>
      )}
    </>
  )
  if (onOpen !== undefined) {
    return (
      <button type="button" aria-label={`Open ${label}`} title={file.name} tabIndex={tabIndex} data-thumbnail="" onClick={() => onOpen(file)} {...sx}>
        {content}
      </button>
    )
  }
  return (
    <figure role="img" aria-label={label} title={file.name} data-thumbnail="" {...sx}>
      {content}
    </figure>
  )
}

/** The icon for each kind of file, on cards and composer chips. */
const styles = stylex.create({
  // The box is sized here, with the aspect ratio as a second guard, so a
  // late image never moves what the user is reading (performance 3.3).
  thumb: {
    position: 'relative',
    margin: 0,
    maxWidth: '100%',
    borderRadius: radii['--radius-xl'],
    backgroundColor: colors['--secondary-default'],
    overflow: 'hidden',
    userSelect: 'none',
  },
  thumbButton: {
    display: 'block',
    padding: 0,
    borderWidth: 0,
    font: 'inherit',
    color: 'inherit',
    textAlign: 'start',
    cursor: 'default',
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
  },
  // The grid of a message's pictures: always the thumbnail box, two columns,
  // so it is sized before any bytes arrive whatever the pictures. The viewer
  // shows each whole.
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: spacing['--space-1-5'],
    width: layout['--thumb-max-width'],
    maxWidth: '100%',
  },
  gridTwo: {
    gridTemplateRows: layout['--thumb-max-height'],
  },
  gridFour: {
    gridTemplateRows: `repeat(2, ${layout['--thumb-tile-height']})`,
  },
  tile: {
    width: '100%',
    height: '100%',
  },
  tall: {
    gridRow: 'span 2',
  },
  moreScrim: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors['--media-scrim'],
    color: colors['--media-scrim-foreground'],
  },
  playBadge: {
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineStart: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: spacing['--space-8'],
    height: spacing['--space-8'],
    borderRadius: radii['--radius-full'],
    backgroundColor: colors['--media-scrim'],
    color: colors['--media-scrim-foreground'],
  },
  box: (width: number, height: number, ratioWidth: number, ratioHeight: number) => ({
    width,
    height,
    aspectRatio: `${ratioWidth} / ${ratioHeight}`,
  }),
  image: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
  },
  imageShown: {
    opacity: 1,
  },
  brokenGlyph: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors['--foreground-muted'],
  },
})
