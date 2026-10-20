import * as stylex from '@stylexjs/stylex'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import type { FileView } from '@juno/contract'
import { colors, layout, motion, radii, spacing, z } from '@juno/tokens/tokens.stylex'
import { IconButton, Surface, Text } from '@juno/ui'
import { Filmstrip } from './Filmstrip'
import type { MediaFile } from './MediaGrid'
import { fullTime, messageTime } from './time'

/** What the viewer shows: a message's images and videos, the one opened, and who sent them when. */
export interface MediaViewing {
  readonly items: ReadonlyArray<MediaFile>
  readonly index: number
  /** The sender's name, as the message shows it. */
  readonly sender: string
  /** When the message was sent, epoch millis. */
  readonly at: number
}

export interface MediaViewerProps {
  readonly viewing: MediaViewing
  /** For the time in the header ("9:12", "Yesterday"). */
  readonly now: number
  /** Esc, Close, or a click on the backdrop. */
  readonly onClose: () => void
  /** Another item is shown, at this index: kept so a remount opens at it. */
  readonly onShowItem?: ((index: number) => void) | undefined
  /** With it, and a `download` url on the item, the header has Download. */
  readonly onDownload?: ((file: FileView) => void) | undefined
  /** With it, and a `download` url on the item, the header has Open: the default app (Preview for images). */
  readonly onOpenFile?: ((file: FileView) => void) | undefined
  /** With it, an image has Copy image. */
  readonly onCopyImage?: ((file: FileView) => void) | undefined
}

/**
 * A message's images and videos over the tab's topic (inventory 6): a dim
 * backdrop, the current item fitted inside the topic in a box sized from its
 * own dimensions, a header with its name, the sender and time and its
 * actions, and along the bottom a filmstrip of every item, the current one
 * marked. ← and →, the side arrows and the strip move through them; Home and
 * End go to the ends. The thumbnail shows at once and the full image fades in
 * over it when it arrives, so nothing moves while it loads; a new item fades
 * in (`--duration-fast`, none with reduced motion), and its neighbours'
 * full images are fetched ahead. Opens in one frame with focus on Close and
 * gives focus back to what had it when it closes. It is not modal: mount it
 * in `TopicView`'s `viewer` slot, which fills the topic with it and makes
 * the topic under it inert, so Tab goes from its controls on to the sidebar
 * and the tab strip. A hidden tab keeps it open at its item.
 */
export function MediaViewer({ viewing, now, onClose, onShowItem, onDownload, onOpenFile, onCopyImage }: MediaViewerProps) {
  const { items } = viewing
  const [index, setIndex] = useState(() => Math.min(Math.max(0, viewing.index), items.length - 1))
  const file = items[index]!
  const several = items.length > 1
  const { root, close } = useViewerFocus(onClose)

  // The neighbours' full images are fetched ahead, so moving to them shows them sharp at once.
  useEffect(() => {
    for (const near of [items[index - 1], items[index + 1]]) {
      if (near?.full === undefined) continue
      const image = new Image()
      image.decoding = 'async'
      image.src = near.full
    }
  }, [items, index])

  const go = (next: number) => {
    const shown = Math.min(Math.max(0, next), items.length - 1)
    setIndex(shown)
    onShowItem?.(shown)
  }
  // A click on the dim around the picture, the bar or the strip closes; one on the picture or a button does not.
  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close()
  }
  const meta = [viewing.sender, messageTime(viewing.at, now), ...(several ? [`${index + 1} of ${items.length}`] : [])].join(' · ')
  return (
    <div
      ref={root}
      role="dialog"
      aria-label={file.name}
      data-media-viewer=""
      onKeyDown={(event) => onViewerKey(event, index, items.length, go, close)}
      onClick={onBackdrop}
      {...stylex.props(styles.backdrop)}
    >
      <div onClick={onBackdrop} {...stylex.props(styles.bar)}>
        <ViewerBar file={file} items={items} meta={meta} at={viewing.at} onClose={close} onDownload={onDownload} onOpenFile={onOpenFile} onCopyImage={onCopyImage} />
      </div>
      <div onClick={onBackdrop} {...stylex.props(styles.stage)}>
        <div onClick={onBackdrop} {...stylex.props(styles.fit)}>
          {/* Keyed by item: a new one fades in, and its full image starts unloaded. */}
          <Item key={index} file={file} position={index + 1} />
        </div>
        {several ? (
          <>
            {/* Dimmed at the ends, not disabled: a focused arrow keeps focus, so the keys keep working. */}
            <span {...stylex.props(styles.arrow, styles.arrowStart)}>
              <IconButton icon={CaretLeft} label="Previous" variant="raised" radius="full" size={36} iconSize={18} dimmed={index === 0} onClick={() => go(index - 1)} />
            </span>
            <span {...stylex.props(styles.arrow, styles.arrowEnd)}>
              <IconButton icon={CaretRight} label="Next" variant="raised" radius="full" size={36} iconSize={18} dimmed={index === items.length - 1} onClick={() => go(index + 1)} />
            </span>
          </>
        ) : null}
      </div>
      {several ? (
        <div onClick={onBackdrop} {...stylex.props(styles.stripBand)}>
          <Filmstrip items={items} index={index} onShow={go} />
        </div>
      ) : null}
    </div>
  )
}

/** Esc closes; ← → Home End move (not while a video has focus: it keeps its own keys). */
function onViewerKey(event: KeyboardEvent<HTMLDivElement>, index: number, count: number, go: (next: number) => void, onClose: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    onClose()
    return
  }
  const inVideo = event.target instanceof HTMLVideoElement
  const move = inVideo ? undefined : { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: count - 1 }[event.key]
  if (move !== undefined) {
    event.preventDefault()
    event.stopPropagation()
    go(move)
  }
}

/**
 * Focus on Close when the viewer first opens, and back on what had focus when it opened after a
 * close. A hidden tab runs the cleanup and then the effect again when it
 * shows, so neither moves focus then. Returns the viewer's root and its close.
 */
function useViewerFocus(onClose: () => void): { readonly root: RefObject<HTMLDivElement | null>; readonly close: () => void } {
  const root = useRef<HTMLDivElement>(null)
  // What had focus when it opened. State, so a tab hidden and shown again keeps it.
  const [opener] = useState(() => document.activeElement)
  const focused = useRef(false)
  const closing = useRef(false)

  useEffect(() => {
    if (!focused.current) {
      focused.current = true
      root.current?.querySelector<HTMLElement>('[data-viewer-close]')?.focus()
    }
    return () => {
      if (closing.current && opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [opener])
  const close = () => {
    closing.current = true
    onClose()
  }
  return { root, close }
}

interface ViewerBarProps extends Pick<MediaViewerProps, 'onClose' | 'onDownload' | 'onOpenFile' | 'onCopyImage'> {
  readonly file: MediaFile
  readonly items: ReadonlyArray<MediaFile>
  readonly meta: string
  readonly at: number
}

/** The name, the sender and time, and the actions. The same buttons for every item, so the bar never moves; one that does not apply to this item is dimmed. */
function ViewerBar({ file, items, meta, at, onClose, onDownload, onOpenFile, onCopyImage }: ViewerBarProps) {
  const canDownload = file.download !== undefined
  const anyDownload = items.some((item) => item.download !== undefined)
  const anyImage = items.some((item) => item.kind === 'image')
  return (
    <Surface kind="toolbar" padding="xs" sx={styles.barSurface}>
      <span {...stylex.props(styles.heading)}>
        <Text variant="ui" weight="medium" tone="default" truncate dir="auto" data-sensitive="" data-viewer-name="">
          {file.name}
        </Text>
        <Text variant="meta" tone="muted" truncate numeric title={fullTime(at)} data-viewer-meta="">
          {meta}
        </Text>
      </span>
      {anyDownload && onDownload !== undefined ? (
        <IconButton icon={DownloadSimple} label="Download" size={28} iconSize={16} dimmed={!canDownload} onClick={() => canDownload && onDownload(file)} />
      ) : null}
      {anyDownload && onOpenFile !== undefined ? (
        <IconButton icon={ArrowSquareOut} label="Open in default app" size={28} iconSize={16} dimmed={!canDownload} onClick={() => canDownload && onOpenFile(file)} />
      ) : null}
      {anyImage && onCopyImage !== undefined ? (
        <IconButton icon={Copy} label="Copy image" size={28} iconSize={16} dimmed={file.kind !== 'image'} onClick={() => file.kind === 'image' && onCopyImage(file)} />
      ) : null}
      <IconButton data-viewer-close="" icon={X} label="Close" size={28} iconSize={16} onClick={onClose} />
    </Surface>
  )
}

/** One item in a box fitted to the stage: the thumbnail at once, the full image fading in over it, or the video over its poster. */
function Item({ file, position }: { readonly file: MediaFile; readonly position: number }) {
  const [loaded, setLoaded] = useState(false)
  const full = file.kind === 'image' ? file.full : undefined
  const width = file.width ?? file.thumb.width
  const height = file.height ?? file.thumb.height
  return (
    <div data-viewer-item={position} {...stylex.props(styles.frame, styles.fitted(width, height))}>
      <img src={file.thumb.src} alt="" draggable={false} decoding="async" {...stylex.props(styles.image)} />
      {full === undefined ? null : (
        <img src={full} alt={file.name} draggable={false} decoding="async" onLoad={() => setLoaded(true)} {...stylex.props(styles.image, styles.full, loaded && styles.fullShown)} />
      )}
      {file.kind === 'video' && file.video !== undefined ? (
        <video src={file.video} poster={file.thumb.src} controls playsInline preload="metadata" aria-label={file.name} {...stylex.props(styles.image)} />
      ) : null}
    </div>
  )
}

const enter = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  // Fills the topic (`TopicView`'s `viewer` slot), over its header islands.
  backdrop: {
    position: 'absolute',
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
    paddingTop: spacing['--space-3'],
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-3'],
  },
  // One width for every item, so moving between them never moves the buttons.
  barSurface: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    width: layout['--viewer-bar-width'],
    maxWidth: '100%',
    minWidth: 0,
    paddingInlineStart: spacing['--space-3'],
  },
  heading: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    marginInlineEnd: spacing['--space-2'],
  },
  // The space the picture may fill, with room at the sides for the arrows.
  stage: {
    position: 'relative',
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
    paddingInline: spacing['--space-16'],
    paddingBottom: spacing['--space-4'],
  },
  // Its size is what the topic leaves, never the picture's.
  fit: {
    flexGrow: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    containerType: 'size',
  },
  frame: {
    position: 'relative',
    flexShrink: 0,
    borderRadius: radii['--radius-xl'],
    overflow: 'hidden',
    backgroundColor: colors['--secondary-default'],
    animationName: enter,
    animationDuration: motion['--duration-fast'],
    animationTimingFunction: motion['--ease-out'],
  },
  // As large as the picture, or as the stage allows, at the picture's aspect ratio: known before any bytes arrive.
  fitted: (width: number, height: number) => ({
    width: `min(${width}px, 100cqw, calc(100cqh * ${width} / ${height}))`,
    aspectRatio: `${width} / ${height}`,
  }),
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
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
  },
  fullShown: {
    opacity: 1,
  },
  arrow: {
    position: 'absolute',
    insetBlockStart: '50%',
    transform: 'translateY(-50%)',
  },
  arrowStart: {
    insetInlineStart: spacing['--space-3'],
  },
  arrowEnd: {
    insetInlineEnd: spacing['--space-3'],
  },
  stripBand: {
    display: 'flex',
    justifyContent: 'center',
    flexShrink: 0,
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-5'],
  },
})
