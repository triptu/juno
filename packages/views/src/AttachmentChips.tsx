import * as stylex from '@stylexjs/stylex'
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { FileKind } from '@juno/contract'
import { colors, motion, opacity, radii, sizes, spacing, tints } from '@juno/tokens/tokens.stylex'
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
}

export interface AttachmentChipsProps {
  readonly files: ReadonlyArray<AttachmentChip>
  readonly onRemove: (id: string) => void
}

// A chip's longest side: a file chip's name gives way past it.
const CHIP_MAX_WIDTH = '240px'

const FAILED = 'Could not read this file'

function kindOf(mimetype: string): FileKind {
  if (mimetype === 'application/pdf') return 'pdf'
  const family = mimetype.split('/')[0]
  return family === 'image' || family === 'video' || family === 'audio' ? family : 'file'
}

/**
 * The chips of the files going with a message, in the composer's field
 * (inventory 7). An image with a preview is a square thumbnail; anything else
 * is its kind's icon, the name and the size. Every chip is 44px tall, so a
 * chip arriving, changing state or going never moves the others on its line.
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
      <img src={preview} alt={file.name} data-sensitive="" draggable={false} decoding="async" loading="lazy" {...stylex.props(styles.thumb, file.state === 'staging' && styles.staging)} />
      <span {...stylex.props(styles.cornerRemove)}>
        <IconButton icon={X} label={`Remove ${file.name}`} size={20} iconSize={12} radius="full" variant="raised" noTooltip onClick={() => onRemove(file.id)} />
      </span>
    </div>
  )
}

function FileChip({ file, onRemove }: ChipProps) {
  const failed = file.state === 'failed'
  return (
    <div role="listitem" title={failed ? FAILED : file.name} data-attachment={file.state} {...stylex.props(styles.chip, styles.fileChip, failed && styles.failedChip)}>
      <span {...stylex.props(styles.fileBody, file.state === 'staging' && styles.staging)}>
        <span {...stylex.props(styles.icon, failed && styles.failedIcon)}>
          <Icon icon={failed ? WarningCircle : fileIcon[kindOf(file.mimetype)]} size={18} />
        </span>
        <span {...stylex.props(styles.text, failed && styles.failedText)}>
          <Text variant="ui" weight="medium" tone="default" truncate dir="auto" data-sensitive="">
            {file.name}
          </Text>
          <Text variant="meta" tone={failed ? 'inherit' : 'muted'} truncate>
            {failed ? 'Could not read' : file.size === undefined ? '\u00a0' : fileSize(file.size)}
          </Text>
        </span>
      </span>
      <IconButton icon={X} label={`Remove ${file.name}`} size={20} iconSize={12} radius="full" tone="muted" noTooltip onClick={() => onRemove(file.id)} />
    </div>
  )
}

const HOVER = '@media (hover: hover)'

const styles = stylex.create({
  list: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  // Concentric with the composer field: its 20px corner less the 6px inset.
  chip: {
    position: 'relative',
    flexShrink: 0,
    boxSizing: 'border-box',
    height: sizes['--control-44'],
    borderRadius: radii['--radius-2xl'],
    userSelect: 'none',
  },
  // The box is the chip's from the start, so the picture arriving moves nothing.
  thumbChip: {
    width: sizes['--control-44'],
    overflow: 'hidden',
    backgroundColor: colors['--secondary-default'],
    // The remove button shows while the chip is pointed at or holds keyboard focus.
    '--chip-remove-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
      ':focus-within': '1',
    },
  },
  thumb: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  cornerRemove: {
    position: 'absolute',
    top: spacing['--space-0-5'],
    right: spacing['--space-0-5'],
    display: 'inline-flex',
    opacity: 'var(--chip-remove-opacity)',
    transitionProperty: 'opacity',
    transitionDuration: {
      default: motion['--duration-fast'],
      '@media (prefers-reduced-motion: reduce)': '0ms',
    },
  },
  fileChip: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    maxWidth: CHIP_MAX_WIDTH,
    minWidth: 0,
    flexShrink: 1,
    paddingInlineStart: spacing['--space-1'],
    paddingInlineEnd: spacing['--space-1-5'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--border-default'],
    backgroundColor: colors['--background'],
  },
  failedChip: {
    borderColor: 'transparent',
    backgroundColor: tints['--tint-warning-bg'],
  },
  fileBody: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    flexGrow: 1,
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: spacing['--space-8'],
    height: spacing['--space-8'],
    borderRadius: radii['--radius-xl'],
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
