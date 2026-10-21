import * as stylex from '@stylexjs/stylex'
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { AttachmentFailure, FileKind } from '@juno/contract'
import { colors, opacity, radii, sizes, spacing, tints } from '@juno/tokens/tokens.stylex'
import { Icon, IconButton, Text } from '@juno/ui'
import { fileIcon, fileSize } from './FileCard'

/**
 * A file going with the message being written. `staging` while its bytes are
 * read, `ready` once staged, `failed` when it could not be read.
 */
export interface AttachmentChip {
  readonly id: string
  readonly name: string
  /** Bytes, once known. */
  readonly size: number | undefined
  readonly mimetype: string
  /** An image's preview src: the chip shows the picture. */
  readonly preview?: string
  readonly state: 'staging' | 'ready' | 'failed'
  readonly failure?: AttachmentFailure
}

export interface AttachmentChipsProps {
  readonly files: ReadonlyArray<AttachmentChip>
  readonly onRemove: (id: string) => void
}

// A chip's longest side: a file chip's name gives way past it.
const CHIP_MAX_WIDTH = '240px' // tokens-allow: a file chip's widest

const FAILURES: Record<AttachmentFailure, string> = {
  read_error: 'Could not read this file',
  not_signed_in: 'Sign in to attach this file',
  bad_chunk: 'Could not attach this file. Try attaching it again.',
  file_too_large: 'This file is too large to attach',
  connection_error: 'Connection lost while attaching this file. Try again.',
  engine_error: 'Could not save this file in Juno. Try attaching it again.',
}

function kindOf(mimetype: string): FileKind {
  if (mimetype === 'application/pdf') return 'pdf'
  const family = mimetype.split('/')[0]
  return family === 'image' || family === 'video' || family === 'audio' ? family : 'file'
}

/**
 * The chips of the files going with a message, in the composer's field
 * (inventory 7). Every chip is the same 44px frame with a hairline border: an
 * image with a preview is the picture filling a 44px square, anything else is
 * its kind's icon, the name and the size. Both have the same remove button in
 * the top end corner, 4px from the frame. A chip arriving, changing state or
 * going never moves the others on its line.
 */
export function AttachmentChips({ files, onRemove }: AttachmentChipsProps) {
  return (
    <div role="list" aria-label="Attachments" {...stylex.props(styles.list)}>
      {files.map((file) =>
        file.preview !== undefined && file.state !== 'failed' ? (
          <ThumbnailChip key={file.id} file={file} preview={file.preview} onRemove={onRemove} />
        ) : (
          <FileChip key={file.id} file={file} onRemove={onRemove} />
        ),
      )}
    </div>
  )
}

interface ChipProps {
  readonly file: AttachmentChip
  readonly onRemove: (id: string) => void
}

function ThumbnailChip({ file, preview, onRemove }: ChipProps & { readonly preview: string }) {
  return (
    <div role="listitem" title={file.name} data-attachment={file.state} {...stylex.props(styles.chip, styles.thumbChip)}>
      <img src={preview} alt={file.name} data-sensitive="" draggable={false} decoding="async" {...stylex.props(styles.thumb, file.state === 'staging' && styles.staging)} />
      <Frame />
      <Remove file={file} onRemove={onRemove} />
    </div>
  )
}

function FileChip({ file, onRemove }: ChipProps) {
  const failed = file.state === 'failed'
  const failureLabel = file.failure === undefined || file.failure === 'read_error' ? 'Could not read' : 'Could not attach'
  return (
    <div role="listitem" title={failed ? FAILURES[file.failure ?? 'read_error'] : file.name} data-attachment={file.state} {...stylex.props(styles.chip, styles.fileChip, failed && styles.failedChip)}>
      <span {...stylex.props(styles.fileBody, file.state === 'staging' && styles.staging)}>
        <span {...stylex.props(styles.icon, failed && styles.failedIcon)}>
          <Icon icon={failed ? WarningCircle : fileIcon[kindOf(file.mimetype)]} size={18} />
        </span>
        <span {...stylex.props(styles.text, failed && styles.failedText)}>
          <Text variant="ui" weight="medium" tone="default" truncate dir="auto" data-sensitive="">
            {file.name}
          </Text>
          <Text variant="meta" tone={failed ? 'inherit' : 'muted'} truncate>
            {failed ? failureLabel : file.size === undefined ? '\u00a0' : fileSize(file.size)}
          </Text>
        </span>
      </span>
      <Frame failed={failed} />
      <Remove file={file} onRemove={onRemove} />
    </div>
  )
}

/** The chip's border, drawn over its content so a picture is framed like a file. */
function Frame({ failed = false }: { readonly failed?: boolean }) {
  return <span aria-hidden="true" data-chip-frame="" {...stylex.props(styles.frame, failed && styles.failedFrame)} />
}

function Remove({ file, onRemove }: ChipProps) {
  return (
    <span {...stylex.props(styles.remove)}>
      <IconButton icon={X} label={`Remove ${file.name}`} size={20} iconSize={12} radius="full" variant="raised" noTooltip onClick={() => onRemove(file.id)} />
    </span>
  )
}

const styles = stylex.create({
  list: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  // Concentric with the composer field: its 20px corner less the 6px inset.
  // Insets inside are measured from the outer edge: the border is the frame
  // drawn on top, so it takes no room.
  chip: {
    position: 'relative',
    flexShrink: 0,
    boxSizing: 'border-box',
    height: sizes['--control-44'],
    borderRadius: radii['--radius-2xl'],
    overflow: 'hidden',
    userSelect: 'none',
  },
  frame: {
    position: 'absolute',
    inset: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--border-default'],
    borderRadius: 'inherit',
    pointerEvents: 'none',
  },
  failedFrame: {
    borderColor: 'transparent',
  },
  // The box is the chip's from the start, so the picture arriving moves nothing.
  thumbChip: {
    width: sizes['--control-44'],
    backgroundColor: colors['--secondary-default'],
  },
  thumb: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  // 4px from the top and end edges, so its 10px radius is concentric with the chip's 14.
  remove: {
    position: 'absolute',
    top: spacing['--space-1'],
    insetInlineEnd: spacing['--space-1'],
    display: 'inline-flex',
  },
  // The icon tile is 6px from the start, top and bottom edges. The end
  // keeps the remove button's 20px and 4px either side clear of the name.
  fileChip: {
    display: 'flex',
    alignItems: 'center',
    maxWidth: CHIP_MAX_WIDTH,
    minWidth: 0,
    flexShrink: 1,
    paddingInlineStart: spacing['--space-1-5'],
    paddingInlineEnd: spacing['--space-7'],
    backgroundColor: colors['--background'],
  },
  failedChip: {
    backgroundColor: tints['--tint-warning-bg'],
  },
  fileBody: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    flexGrow: 1,
  },
  // Concentric with the chip: its 14px corner less the 6px inset.
  icon: {
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
  failedIcon: {
    backgroundColor: 'transparent',
    color: tints['--tint-warning-fg'],
  },
  failedText: {
    color: tints['--tint-warning-fg'],
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  // Quiet while the bytes are read: no spinner, the content a step dimmer.
  staging: {
    opacity: opacity['--opacity-dim'],
  },
})
