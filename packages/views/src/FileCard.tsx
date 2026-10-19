import * as stylex from '@stylexjs/stylex'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { File } from '@phosphor-icons/react/dist/icons/File'
import { FilePdf } from '@phosphor-icons/react/dist/icons/FilePdf'
import { Image } from '@phosphor-icons/react/dist/icons/Image'
import { MusicNote } from '@phosphor-icons/react/dist/icons/MusicNote'
import { VideoCamera } from '@phosphor-icons/react/dist/icons/VideoCamera'
import type { FileKind, FileView } from '@juno/contract'
import { accent, colors, layout, motion, radii, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, IconButton, Surface, Text, type PhosphorIcon } from '@juno/ui'
import { isMedia, MediaGrid, mediaOf } from './MediaGrid'

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
  /** No space above: the files sit in a shared message's card, which spaces its own content. */
  readonly flush?: boolean
}

// The upload line's thickness.
const PROGRESS_HEIGHT = '2px' // tokens-allow: the upload line's thickness


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
export function Files({ files, onOpenMedia, onDownload, tabbable = true, progress, flush = false }: FilesProps) {
  if (files.length === 0) return null
  const tabIndex = tabbable ? 0 : -1
  const media = mediaOf(files)
  const first = files.findIndex(isMedia)
  return (
    <div {...stylex.props(styles.files, flush && styles.flush)}>
      {files.map((file, index) => {
        if (index === first) return <MediaGrid key="media" media={media} onOpen={onOpenMedia} tabIndex={tabIndex} />
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
  flush: { marginTop: 0 },
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
