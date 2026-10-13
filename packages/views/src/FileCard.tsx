import * as stylex from '@stylexjs/stylex'
import { File } from '@phosphor-icons/react/dist/icons/File'
import { FilePdf } from '@phosphor-icons/react/dist/icons/FilePdf'
import { Image } from '@phosphor-icons/react/dist/icons/Image'
import { MusicNote } from '@phosphor-icons/react/dist/icons/MusicNote'
import { VideoCamera } from '@phosphor-icons/react/dist/icons/VideoCamera'
import { useState } from 'react'
import type { FileKind, FileThumb, FileView } from '@juno/contract'
import { colors, layout, motion, radii, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, Surface, Text, type PhosphorIcon } from '@juno/ui'

export interface FilesProps {
  readonly files: ReadonlyArray<FileView>
}

/**
 * The files under a message, in Slack's order: an image with a thumbnail is
 * the thumbnail in a box of its final size, anything else is a card.
 */
export function Files({ files }: FilesProps) {
  if (files.length === 0) return null
  return (
    <div {...stylex.props(styles.files)}>
      {files.map((file) => (file.thumb === undefined ? <FileCard key={file.id} file={file} /> : <Thumbnail key={file.id} file={file} thumb={file.thumb} />))}
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

function Thumbnail({ file, thumb }: { readonly file: FileView; readonly thumb: FileThumb }) {
  const [loaded, setLoaded] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState<string | undefined>(undefined)
  const box = thumbnailBox(thumb.width, thumb.height)
  const broken = failed === thumb.src
  return (
    <figure
      role="img"
      aria-label={file.name}
      title={file.name}
      {...stylex.props(styles.thumb, styles.box(box.width, box.height, thumb.width, thumb.height))}
    >
      {broken ? (
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
      )}
    </figure>
  )
}

const iconByKind: Record<FileKind, PhosphorIcon> = {
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

/** A fixed-height card for a file with no thumbnail: icon, name and a meta line. */
function FileCard({ file }: { readonly file: FileView }) {
  const deleted = file.kind === 'deleted'
  return (
    <Surface kind="inset" radius="xl" padding="none" sx={styles.card}>
      <span {...stylex.props(styles.cardIcon, deleted && styles.deletedIcon)}>
        <Icon icon={iconByKind[file.kind]} size={18} />
      </span>
      <span {...stylex.props(styles.cardText)}>
        <Text variant="ui" weight="medium" tone={deleted ? 'muted' : 'default'} truncate dir="auto" title={file.name}>
          {deleted ? 'File no longer available' : file.name}
        </Text>
        <Text variant="meta" tone="muted" truncate>
          {fileMeta(file)}
        </Text>
      </span>
    </Surface>
  )
}

const styles = stylex.create({
  files: {
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
  cardText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flexGrow: 1,
  },
})
