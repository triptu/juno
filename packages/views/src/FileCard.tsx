import * as stylex from '@stylexjs/stylex'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { File } from '@phosphor-icons/react/dist/icons/File'
import { FilePdf } from '@phosphor-icons/react/dist/icons/FilePdf'
import { Image } from '@phosphor-icons/react/dist/icons/Image'
import { MusicNote } from '@phosphor-icons/react/dist/icons/MusicNote'
import { VideoCamera } from '@phosphor-icons/react/dist/icons/VideoCamera'
import { useState } from 'react'
import type { FileKind, FileThumb, FileView } from '@juno/contract'
import { accent, colors, layout, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, IconButton, Surface, Text, type PhosphorIcon } from '@juno/ui'

export interface FilesProps {
  readonly files: ReadonlyArray<FileView>
  /** A thumbnail is a button that opens the image viewer. Created once by the container. */
  readonly onOpenImage?: ((file: FileView) => void) | undefined
  /** A card with a `download` url gets a Download button. Created once by the container. */
  readonly onDownload?: ((file: FileView) => void) | undefined
  /** Roving tabindex: the buttons are in the tab order only on the row that Tab reaches. */
  readonly tabbable?: boolean
  /** How far the files' upload has got, 0 to 1: a slim line under them that takes no room. */
  readonly progress?: number | undefined
}

// The upload line's thickness.
const PROGRESS_HEIGHT = '2px'

/**
 * The files under a message, in Slack's order: an image with a thumbnail is
 * the thumbnail in a box of its final size, anything else is a card. While
 * the message uploads, a slim line under the files shows how far it has got;
 * it is drawn over the row's bottom padding, so it appearing or going moves
 * nothing.
 */
export function Files({ files, onOpenImage, onDownload, tabbable = true, progress }: FilesProps) {
  if (files.length === 0) return null
  const tabIndex = tabbable ? 0 : -1
  return (
    <div {...stylex.props(styles.files)}>
      {files.map((file) =>
        file.thumb === undefined ? (
          <FileCard key={file.id} file={file} onDownload={onDownload} tabIndex={tabIndex} />
        ) : (
          <Thumbnail key={file.id} file={file} thumb={file.thumb} onOpen={onOpenImage} tabIndex={tabIndex} />
        ),
      )}
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

// The thumbnail's caps, as numbers for the size arithmetic below. They
// repeat --thumb-max-width and --thumb-max-height.
const THUMB_MAX_WIDTH = 360
const THUMB_MAX_HEIGHT = 280

/** The box an image gets, from its own dimensions and the caps, before any bytes arrive. */
export function thumbnailBox(width: number, height: number): { readonly width: number; readonly height: number } {
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
}

/** With `onOpen` the box is a button with the same look; Enter and Space open it too. */
function Thumbnail({ file, thumb, onOpen, tabIndex }: ThumbnailProps) {
  const [loaded, setLoaded] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState<string | undefined>(undefined)
  const box = thumbnailBox(thumb.width, thumb.height)
  const broken = failed === thumb.src
  const sx = stylex.props(styles.thumb, styles.box(box.width, box.height, thumb.width, thumb.height), onOpen !== undefined && styles.thumbButton)
  const content = broken ? (
    <span {...stylex.props(styles.brokenGlyph)}>
      <Icon icon={Image} size={18} />
    </span>
  ) : (
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
  )
  if (onOpen !== undefined) {
    return (
      <button type="button" aria-label={`Open ${file.name}`} title={file.name} tabIndex={tabIndex} data-thumbnail="" onClick={() => onOpen(file)} {...sx}>
        {content}
      </button>
    )
  }
  return (
    <figure role="img" aria-label={file.name} title={file.name} data-thumbnail="" {...sx}>
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
    top: 'calc(100% + 1px)',
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
