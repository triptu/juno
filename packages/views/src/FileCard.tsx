import * as stylex from '@stylexjs/stylex'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { Eye } from '@phosphor-icons/react/dist/icons/Eye'
import { File } from '@phosphor-icons/react/dist/icons/File'
import { FileCode } from '@phosphor-icons/react/dist/icons/FileCode'
import { FilePdf } from '@phosphor-icons/react/dist/icons/FilePdf'
import { FileText } from '@phosphor-icons/react/dist/icons/FileText'
import { Image } from '@phosphor-icons/react/dist/icons/Image'
import { MusicNote } from '@phosphor-icons/react/dist/icons/MusicNote'
import { VideoCamera } from '@phosphor-icons/react/dist/icons/VideoCamera'
import type { FileKind, FileView } from '@juno/contract'
import { accent, colors, layout, motion, radii, spacing } from '@juno/tokens/tokens.stylex'
import { focusRing, Icon, IconButton, Surface, Text, type PhosphorIcon } from '@juno/ui'
import { isDocument, isMedia, MediaGrid, mediaOf } from './MediaGrid'

export interface FilesProps {
  readonly files: ReadonlyArray<FileView>
  /** An image, a video, or a card of a file the viewer shows (`isDocument`), opens the media viewer at it. Created once by the container. */
  readonly onOpenMedia?: ((file: FileView) => void) | undefined
  /** A card with a `download` url gets a Download button. Created once by the container. */
  readonly onDownload?: ((file: FileView) => void) | undefined
  /** A card of a file the viewer cannot show, with a `download` url, gets Quick Look. Created once by the container. */
  readonly onQuickLook?: ((file: FileView) => void) | undefined
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
 * so it is sized before any bytes arrive. Every other file is a card: one
 * the viewer shows (audio, PDF, HTML, text) opens it on click, and a lone
 * audio file or voice clip has a player in its card; any other has Quick
 * Look. Each keeps Download. While
 * the message uploads, a slim line under the files shows how far it has got;
 * it is drawn over the row's bottom padding, so it appearing or going moves
 * nothing.
 */
export function Files({ files, onOpenMedia, onDownload, onQuickLook, tabbable = true, progress, flush = false }: FilesProps) {
  if (files.length === 0) return null
  const tabIndex = tabbable ? 0 : -1
  const media = mediaOf(files)
  const first = files.findIndex(isMedia)
  return (
    <div {...stylex.props(styles.files, flush && styles.flush)}>
      {files.map((file, index) => {
        if (index === first) return <MediaGrid key="media" media={media} onOpen={onOpenMedia} tabIndex={tabIndex} />
        if (isMedia(file)) return null
        return <FileCard key={`card:${index}`} file={file} onOpen={onOpenMedia} onDownload={onDownload} onQuickLook={onQuickLook} player={files.length === 1 && file.kind === 'audio'} tabIndex={tabIndex} />
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
  html: FileCode,
  text: FileText,
  file: File,
  deleted: File,
}

/** A card's icon: its kind's, and for text the code it holds. */
export function fileCardIcon(file: FileView): PhosphorIcon {
  if (file.textKind === 'json' || file.textKind === 'code') return FileCode
  return fileIcon[file.kind]
}

const KB = 1024
const MB = KB * 1024

/** "1.2 MB", "340 KB", "900 B". */
export function fileSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`
  return `${bytes} B`
}

/** A clip's length: "5:00", "1:02:09". */
export function duration(millis: number): string {
  const seconds = Math.round(millis / 1000)
  const [hours, minutes, rest] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`
}

/** The meta line of a card: the kind or extension, then the size. */
export function fileMeta(file: FileView): string {
  if (file.kind === 'deleted') return 'File deleted'
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toUpperCase() : undefined
  const kind = file.kind === 'pdf' ? 'PDF' : file.language ?? (extension ?? file.mimetype?.split('/')[0] ?? file.kind)
  const parts = [kind, ...(file.size === undefined ? [] : [fileSize(file.size)]), ...(file.durationMs === undefined ? [] : [duration(file.durationMs)]), ...(file.lines === undefined ? [] : [`${file.lines.toLocaleString()} ${file.lines === 1 ? 'line' : 'lines'}`])]
  return parts.join(' · ')
}

interface FileCardProps {
  readonly file: FileView
  readonly onOpen: ((file: FileView) => void) | undefined
  readonly onDownload: ((file: FileView) => void) | undefined
  readonly onQuickLook: ((file: FileView) => void) | undefined
  /** The message's only file is audio: a player under the name, as a lone video plays in the message. */
  readonly player: boolean
  readonly tabIndex: number
}

/**
 * A fixed-height card for a file with no thumbnail: icon, name and a meta
 * line, then Quick Look for a file the viewer cannot show and Download when
 * Slack has the file. A file the viewer shows opens it from the icon and
 * name. The buttons are shorter than the icon, so the card is the same
 * height with or without them. A lone audio file adds a player of fixed
 * height, which fetches nothing until Play.
 */
function FileCard({ file, onOpen, onDownload, onQuickLook, player, tabIndex }: FileCardProps) {
  const deleted = file.kind === 'deleted'
  const opens = onOpen !== undefined && isDocument(file)
  const label = (
    <>
      <span {...stylex.props(styles.cardIcon, deleted && styles.deletedIcon)}>
        <Icon icon={fileCardIcon(file)} size={18} />
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
    </>
  )
  const row = (
    <span {...stylex.props(styles.row)}>
      {opens ? (
        <button type="button" aria-label={`Open ${file.name}`} title={file.name} tabIndex={tabIndex} data-file-open="" onClick={() => onOpen(file)} {...stylex.props(styles.open, focusRing.outside)}>
          {label}
        </button>
      ) : (
        label
      )}
      {!opens && !deleted && file.download !== undefined && onQuickLook !== undefined ? (
        <IconButton icon={Eye} label={`Quick Look ${file.name}`} size={28} iconSize={16} tone="subtle" tabIndex={tabIndex} onClick={() => onQuickLook(file)} />
      ) : null}
      {file.download !== undefined && onDownload !== undefined && !deleted ? (
        <IconButton icon={DownloadSimple} label={`Download ${file.name}`} size={28} iconSize={16} tone="subtle" tabIndex={tabIndex} onClick={() => onDownload(file)} />
      ) : null}
    </span>
  )
  return (
    <Surface kind="inset" radius="xl" padding="none" data-file-card="" data-file-kind={file.kind} sx={[styles.card, player && file.audio !== undefined && styles.playerCard]}>
      {row}
      {player && file.audio !== undefined ? <audio src={file.audio} controls preload="none" tabIndex={tabIndex} aria-label={file.name} data-inline-audio="" {...stylex.props(styles.player)} /> : null}
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
    // Chrome, also inside a shared message's card, whose selectable text would give it the text cursor.
    cursor: 'default',
  },
  flush: { marginTop: 0 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    width: layout['--thumb-max-width'],
    maxWidth: '100%',
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2-5'],
    userSelect: 'none',
  },
  playerCard: {
    gap: spacing['--space-2'],
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    minWidth: 0,
  },
  // The icon and name of a file the viewer shows: a button that looks like the card.
  open: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    flexGrow: 1,
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-lg'],
    backgroundColor: 'transparent',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'start',
    cursor: 'default',
  },
  player: {
    display: 'block',
    width: '100%',
    height: spacing['--space-8'],
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
