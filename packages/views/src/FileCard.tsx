import * as stylex from '@stylexjs/stylex'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { File } from '@phosphor-icons/react/dist/icons/File'
import { FilePdf } from '@phosphor-icons/react/dist/icons/FilePdf'
import { Image } from '@phosphor-icons/react/dist/icons/Image'
import { MusicNote } from '@phosphor-icons/react/dist/icons/MusicNote'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { VideoCamera } from '@phosphor-icons/react/dist/icons/VideoCamera'
import { useState } from 'react'
import type { FileKind, FileThumb, FileView } from '@juno/contract'
import { accent, colors, layout, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, IconButton, Surface, Text, type PhosphorIcon } from '@juno/ui'

export interface FilesProps {
  readonly files: ReadonlyArray<FileView>
  /** An image or video opens the media viewer at it. Created once by the container. */
  readonly onOpenMedia?: ((file: FileView) => void) | undefined
  /** A card with a `download` url gets a Download button. Created once by the container. */
  readonly onDownload?: ((file: FileView) => void) | undefined
  /** Roving tabindex: the buttons are in the tab order only on the row that Tab reaches. */
  readonly tabbable?: boolean
  /** How far the files' upload has got, 0 to 1: a slim line under them that takes no room. */
  readonly progress?: number | undefined
}

// The upload line's thickness.
const PROGRESS_HEIGHT = '2px'

/** Tiles a message's grid shows; the last says "+N" for the rest. */
const GRID_TILES = 4

/** A file the media viewer shows: an image or a video with a picture to show for it. */
export type MediaFile = FileView & { readonly thumb: FileThumb }

export const isMedia = (file: FileView): file is MediaFile => file.thumb !== undefined && (file.kind === 'image' || file.kind === 'video')

/** A message's images and videos, in Slack's order: what its grid and the viewer's filmstrip show. */
export const mediaOf = (files: ReadonlyArray<FileView>): ReadonlyArray<MediaFile> => files.filter(isMedia)

/**
 * The files under a message, in Slack's order. Its images and videos are one
 * block where the first of them is: one is the picture in a box of its final
 * size; two sit side by side, three and four fill a 2 × 2 grid (the first of
 * three takes the left column), and more show "+N" on the fourth tile. The
 * grid is `--thumb-max-width` × `--thumb-max-height` whatever the pictures,
 * so it is sized before any bytes arrive. Every other file is a card. While
 * the message uploads, a slim line under the files shows how far it has got;
 * it is drawn over the row's bottom padding, so it appearing or going moves
 * nothing.
 */
export function Files({ files, onOpenMedia, onDownload, tabbable = true, progress }: FilesProps) {
  if (files.length === 0) return null
  const tabIndex = tabbable ? 0 : -1
  const media = mediaOf(files)
  const first = files.findIndex(isMedia)
  return (
    <div {...stylex.props(styles.files)}>
      {files.map((file, index) => {
        if (index === first) return <MediaBlock key="media" media={media} onOpen={onOpenMedia} tabIndex={tabIndex} />
        if (isMedia(file)) return null
        return <FileCard key={`card:${index}`} file={file} onDownload={onDownload} tabIndex={tabIndex} />
      })}
      {progress === undefined ? null : (
        <span
          role="progressbar"
          aria-label="Uploading"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          data-upload-progress=""
          {...stylex.props(styles.track)}
        >
          <span {...stylex.props(styles.fill, styles.fillScale(Math.min(1, Math.max(0, progress))))} />
        </span>
      )}
    </div>
  )
}

interface MediaBlockProps {
  readonly media: ReadonlyArray<MediaFile>
  readonly onOpen: ((file: FileView) => void) | undefined
  readonly tabIndex: number
}

/** A message's images and videos: the lone picture, or the grid. Tiles are keyed by place, so a sent file whose id changes keeps its image. */
function MediaBlock({ media, onOpen, tabIndex }: MediaBlockProps) {
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
export const fileIcon: Readonly<Record<FileKind, PhosphorIcon>> = {
  image: Image,
  video: VideoCamera,
  audio: MusicNote,
  pdf: FilePdf,
  file: File,
  deleted: File,
}

const KB = 1024
const MB = KB * 1024

/** "1.2 MB", "340 KB", "900 B". */
export function fileSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`
  return `${bytes} B`
}

/** The meta line of a card: the kind or extension, then the size. */
export function fileMeta(file: FileView): string {
  if (file.kind === 'deleted') return 'File deleted'
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toUpperCase() : undefined
  const kind = file.kind === 'pdf' ? 'PDF' : (extension ?? file.mimetype?.split('/')[0] ?? file.kind)
  return file.size === undefined ? kind : `${kind} · ${fileSize(file.size)}`
}

interface FileCardProps {
  readonly file: FileView
  readonly onDownload: ((file: FileView) => void) | undefined
  readonly tabIndex: number
}

/**
 * A fixed-height card for a file with no thumbnail: icon, name and a meta
 * line, and a Download button at the end when Slack has the file. The button
 * is shorter than the icon, so the card is the same height with or without it.
 */
function FileCard({ file, onDownload, tabIndex }: FileCardProps) {
  const deleted = file.kind === 'deleted'
  return (
    <Surface kind="inset" radius="xl" padding="none" data-file-card="" sx={styles.card}>
      <span {...stylex.props(styles.cardIcon, deleted && styles.deletedIcon)}>
        <Icon icon={fileIcon[file.kind]} size={18} />
      </span>
      <span {...stylex.props(styles.cardText)}>
        {deleted ? (
          <Text variant="ui" weight="medium" tone="muted" truncate>
            File no longer available
          </Text>
        ) : (
          <Text variant="ui" weight="medium" tone="default" truncate dir="auto" title={file.name} data-sensitive="">
            {file.name}
          </Text>
        )}
        <Text variant="meta" tone="muted" truncate>
          {fileMeta(file)}
        </Text>
      </span>
      {file.download !== undefined && onDownload !== undefined && !deleted ? (
        <IconButton icon={DownloadSimple} label={`Download ${file.name}`} size={28} iconSize={16} tone="subtle" tabIndex={tabIndex} onClick={() => onDownload(file)} />
      ) : null}
    </Surface>
  )
}

const styles = stylex.create({
  files: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-1-5'],
    marginTop: spacing['--space-1-5'],
    minWidth: 0,
  },
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
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    width: layout['--thumb-max-width'],
    maxWidth: '100%',
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2-5'],
    userSelect: 'none',
  },
  cardIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: spacing['--space-8'],
    height: spacing['--space-8'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-subtle'],
  },
  deletedIcon: {
    color: colors['--foreground-muted'],
  },
  // Under the files, in the row's 4px bottom padding: placed out of flow, so it takes no room.
  track: {
    position: 'absolute',
    insetInline: 0,
    top: 'calc(100% + 1px)', // tokens-allow: Place the menu past the 1px border.
    height: PROGRESS_HEIGHT,
    borderRadius: radii['--radius-full'],
    backgroundColor: colors['--secondary-default'],
    overflow: 'hidden',
  },
  fill: {
    display: 'block',
    width: '100%',
    height: '100%',
    backgroundColor: accent['--hl'],
    transformOrigin: 'left',
    transitionProperty: 'transform',
    transitionDuration: {
      default: motion['--duration-fast'],
      '@media (prefers-reduced-motion: reduce)': '0ms',
    },
    transitionTimingFunction: motion['--ease-out'],
  },
  fillScale: (progress: number) => ({
    transform: `scaleX(${progress})`,
  }),
  cardText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flexGrow: 1,
  },
})
