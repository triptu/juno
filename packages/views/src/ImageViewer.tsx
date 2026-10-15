import * as stylex from '@stylexjs/stylex'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { FileView } from '@juno/contract'
import { colors, layout, motion, radii, spacing, z } from '@juno/tokens/tokens.stylex'
import { IconButton, Surface, Text } from '@juno/ui'

export interface ImageViewerProps {
  readonly file: FileView
  /** Esc, Close, or a click on the backdrop. */
  readonly onClose: () => void
  /** With it, and a `download` url on the file, the viewer has a Download button. */
  readonly onDownload?: (file: FileView) => void
}

/**
 * An image at full size over the whole window (inventory 6): a dim backdrop,
 * the picture fitted inside the window in a box sized from its own
 * dimensions, and a bar with the name, Download and Close. The thumbnail
 * shows at once and the full image fades in over it when it arrives, so
 * nothing moves while it loads. Opens in one frame with focus on Close, and
 * gives focus back to what had it when it closes. Mount it outside the
 * message rows: their paint containment would clip a fixed element.
 */
export function ImageViewer({ file, onClose, onDownload }: ImageViewerProps) {
  const root = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<string | undefined>(undefined)

  useEffect(() => {
    const opener = document.activeElement
    root.current?.querySelector<HTMLElement>('[data-viewer-close]')?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    // Focus stays inside the viewer: Tab goes round its buttons.
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button'))
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  // A click on the dim around the picture and the bar closes; one on the picture or a button does not.
  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }

  const width = file.width ?? file.thumb?.width
  const height = file.height ?? file.thumb?.height
  const full = file.full
  const download = file.download !== undefined && onDownload !== undefined
  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label={file.name} data-image-viewer="" onKeyDown={onKeyDown} onClick={onBackdrop} {...stylex.props(styles.backdrop)}>
      <div onClick={onBackdrop} {...stylex.props(styles.bar)}>
        <Surface kind="toolbar" padding="xs" sx={styles.barSurface}>
          <Text variant="ui" weight="medium" tone="default" truncate dir="auto" data-sensitive="" sx={styles.name}>
            {file.name}
          </Text>
          {download ? <IconButton icon={DownloadSimple} label="Download" size={28} iconSize={16} onClick={() => onDownload(file)} /> : null}
          <IconButton data-viewer-close="" icon={X} label="Close" size={28} iconSize={16} onClick={onClose} />
        </Surface>
      </div>
      <div onClick={onBackdrop} {...stylex.props(styles.stage)}>
        <div {...stylex.props(styles.frame, width !== undefined && height !== undefined ? styles.fitted(width, height) : styles.unsized)}>
          {file.thumb === undefined ? null : <img src={file.thumb.src} alt="" draggable={false} decoding="async" {...stylex.props(styles.image)} />}
          {full === undefined ? null : (
            <img src={full} alt={file.name} draggable={false} decoding="async" onLoad={() => setLoaded(full)} {...stylex.props(styles.image, styles.full, loaded === full && styles.fullShown)} />
          )}
        </div>
      </div>
    </div>
  )
}

const styles = stylex.create({
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: z['--z-viewer'],
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: colors['--overlay-viewer'],
    userSelect: 'none',
  },
  bar: {
    display: 'flex',
    justifyContent: 'center',
    flexShrink: 0,
    paddingTop: layout['--titlebar-height'],
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-3'],
  },
  barSurface: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    maxWidth: layout['--composer-width'],
    minWidth: 0,
    paddingInlineStart: spacing['--space-3'],
  },
  name: {
    flexShrink: 1,
    minWidth: 0,
    marginInlineEnd: spacing['--space-2'],
  },
  // The space the picture may fill; its size is what the window leaves, never the picture's.
  stage: {
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-6'],
    containerType: 'size',
  },
  frame: {
    position: 'relative',
    flexShrink: 0,
    borderRadius: radii['--radius-xl'],
    overflow: 'hidden',
    backgroundColor: colors['--secondary-default'],
  },
  // As large as the picture, or as the stage allows, at the picture's aspect ratio: known before any bytes arrive.
  fitted: (width: number, height: number) => ({
    width: `min(${width}px, 100cqw, calc(100cqh * ${width} / ${height}))`,
    aspectRatio: `${width} / ${height}`,
  }),
  unsized: {
    width: '100cqw',
    height: '100cqh',
  },
  image: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  full: {
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: {
      default: motion['--duration-fast'],
      '@media (prefers-reduced-motion: reduce)': '0ms',
    },
    transitionTimingFunction: motion['--ease-out'],
  },
  fullShown: {
    opacity: 1,
  },
})
