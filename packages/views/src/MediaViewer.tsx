import * as stylex from '@stylexjs/stylex'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { Eye } from '@phosphor-icons/react/dist/icons/Eye'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import type { FileView } from '@juno/contract'
import { colors, layout, motion, radii, spacing, z } from '@juno/tokens/tokens.stylex'
import { IconButton, Surface, Text } from '@juno/ui'
import { Filmstrip } from './Filmstrip'
import { isMedia, type MediaFile } from './MediaGrid'
import { fullTime, messageTime } from './time'
import { ViewerDocument, type DocumentLinks, type LoadFileText } from './ViewerDocument'
import { useZoom } from './zoom'

/** What the viewer shows: every file of a message it can show (`viewableOf`), the one opened, and who sent them when. */
export interface MediaViewing {
  readonly items: ReadonlyArray<FileView>
  readonly index: number
  /** The sender's name, as the message shows it. */
  readonly sender: string
  /** When the message was sent, epoch millis. */
  readonly at: number
}

/** `onLink` and `linkInfo` are for the links of a Markdown file, as a message's links. */
export interface MediaViewerProps extends DocumentLinks {
  readonly viewing: MediaViewing
  /** For the time in the header ("9:12", "Yesterday"). */
  readonly now: number
  /** Esc, Close, or a click on the backdrop. */
  readonly onClose: () => void
  /** What had focus when it opened, taken in the open handler before the topic under it turns inert. Focus goes back to it on close. */
  readonly opener?: Element | null | undefined
  /** Another item is shown, at this index: kept so a remount opens at it. */
  readonly onShowItem?: ((index: number) => void) | undefined
  /** With it, and a `download` url on the item, the header has Download. */
  readonly onDownload?: ((file: FileView) => void) | undefined
  /** With it, and a `download` url on the item, the header has Quick Look: the macOS preview window. */
  readonly onQuickLook?: ((file: FileView) => void) | undefined
  /** With it, an HTML file has Open in browser. */
  readonly onOpenInBrowser?: ((file: FileView) => void) | undefined
  /** Reads a text file's content for the viewer. Without it a text file says it could not be loaded. */
  readonly loadText?: LoadFileText | undefined
  /** With it, an image has Copy image. */
  readonly onCopyImage?: ((file: FileView) => void) | undefined
  /** Right-click on the full image. The container owns the native menu. */
  readonly onImageMenu?: ((file: FileView, event: MouseEvent<Element>) => void) | undefined
}

/**
 * A message's images, videos and the other files it can show (SPEC section
 * 8, "Other files") over the tab's topic (inventory 6): a dim backdrop, the
 * current picture fitted inside the topic in a box sized from its own
 * dimensions, or a PDF, HTML or text file in a frame that fills the stage
 * and scrolls inside it, or an audio player; a header with its name, the sender and time and its
 * actions, and along the bottom a filmstrip of every item, the current one
 * marked. ← and →, the side arrows and the strip move through them; Home and
 * End go to the ends. The thumbnail shows at once and the full image fades in
 * over it when it arrives, so nothing moves while it loads. An image zooms
 * inside its box with a pinch or a double-click, and pans while zoomed; a new item fades
 * in (`--duration-fast`, none with reduced motion), and its neighbours'
 * full images are fetched ahead. Opens in one frame with focus on Close and
 * gives focus back to what had it when it closes. It is not modal: mount it
 * in `TopicView`'s `viewer` slot, which fills the topic with it and makes
 * the topic under it inert, so Tab goes from its controls on to the sidebar
 * and the tab strip. A hidden tab keeps it open at its item.
 */
export function MediaViewer({ viewing, now, opener, onClose, onShowItem, onDownload, onQuickLook, onOpenInBrowser, onCopyImage, onImageMenu, loadText, onLink, linkInfo }: MediaViewerProps) {
  const { items } = viewing
  const [index, setIndex] = useState(() => Math.min(Math.max(0, viewing.index), items.length - 1))
  const file = items[index]!
  const several = items.length > 1
  const { root, close } = useViewerFocus(opener, onClose)

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
  // A click on the dim around the picture, the bar or the strip closes; one on the picture or a button does not,
  // nor one that was pressed elsewhere, such as a drag of a zoomed picture that ends over the dim.
  const pressed = useRef<EventTarget | null>(null)
  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && pressed.current === event.target) close()
  }
  const meta = [viewing.sender, messageTime(viewing.at, now), ...(file.language === undefined ? [] : [file.language]), ...(several ? [`${index + 1} of ${items.length}`] : [])].join(' · ')
  return (
    <div
      ref={root}
      role="dialog"
      aria-label={file.name}
      // A click on the picture or the dim leaves focus here, not on the page, so Esc and the arrows still work.
      tabIndex={-1}
      data-media-viewer=""
      onKeyDown={(event) => onViewerKey(event, index, items.length, go, close)}
      onPointerDown={(event) => {
        pressed.current = event.target
      }}
      onClick={onBackdrop}
      {...stylex.props(styles.backdrop)}
    >
      <div onClick={onBackdrop} {...stylex.props(styles.bar)}>
        <ViewerBar file={file} items={items} meta={meta} at={viewing.at} onClose={close} onDownload={onDownload} onQuickLook={onQuickLook} onOpenInBrowser={onOpenInBrowser} onCopyImage={onCopyImage} />
      </div>
      <div onClick={onBackdrop} {...stylex.props(styles.stage)}>
        <div onClick={onBackdrop} {...stylex.props(styles.fit)}>
          {/* Keyed by item: a new one fades in, its full image starts unloaded and a text file is read again. */}
          {isMedia(file) ? (
            <Item key={index} file={file} position={index + 1} onImageMenu={onImageMenu} />
          ) : (
            <div key={index} data-viewer-item={index + 1} data-viewer-kind={file.kind} {...stylex.props(styles.frame, ...documentBox(file))}>
              <ViewerDocument file={file} now={now} loadText={loadText} onLink={onLink} linkInfo={linkInfo} />
            </div>
          )}
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

/** Esc closes; ← → Home End move (not while a player or a text file has focus: they keep their own keys). */
function onViewerKey(event: KeyboardEvent<HTMLDivElement>, index: number, count: number, go: (next: number) => void, onClose: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    onClose()
    return
  }
  const ownKeys = event.target instanceof HTMLMediaElement || (event.target instanceof HTMLElement && event.target.hasAttribute('data-viewer-text'))
  const move = ownKeys ? undefined : { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: count - 1 }[event.key]
  if (move !== undefined) {
    event.preventDefault()
    event.stopPropagation()
    go(move)
  }
}

/**
 * Focus on Close when the viewer first opens, and back on `opener` after a
 * close. A hidden tab runs the cleanup and then the effect again when it
 * shows, so neither moves focus then. Returns the viewer's root and its close.
 */
function useViewerFocus(opener: Element | null | undefined, onClose: () => void): { readonly root: RefObject<HTMLDivElement | null>; readonly close: () => void } {
  const root = useRef<HTMLDivElement>(null)
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

interface ViewerBarProps extends Pick<MediaViewerProps, 'onClose' | 'onDownload' | 'onQuickLook' | 'onOpenInBrowser' | 'onCopyImage'> {
  readonly file: FileView
  readonly items: ReadonlyArray<FileView>
  readonly meta: string
  readonly at: number
}

/** The name, the sender and time, and the actions. The same buttons for every item, so the bar never moves; one that does not apply to this item is dimmed. */
function ViewerBar({ file, items, meta, at, onClose, onDownload, onQuickLook, onOpenInBrowser, onCopyImage }: ViewerBarProps) {
  const canDownload = file.download !== undefined
  const anyDownload = items.some((item) => item.download !== undefined)
  const anyImage = items.some((item) => item.kind === 'image')
  const isPage = file.kind === 'html' && canDownload
  const anyPage = items.some((item) => item.kind === 'html' && item.download !== undefined)
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
      {anyDownload && onQuickLook !== undefined ? (
        <IconButton icon={Eye} label="Quick Look" size={28} iconSize={16} dimmed={!canDownload} onClick={() => canDownload && onQuickLook(file)} />
      ) : null}
      {anyPage && onOpenInBrowser !== undefined ? (
        <IconButton icon={ArrowSquareOut} label="Open in browser" size={28} iconSize={16} dimmed={!isPage} onClick={() => isPage && onOpenInBrowser(file)} />
      ) : null}
      {anyImage && onCopyImage !== undefined ? (
        <IconButton icon={Copy} label="Copy image" size={28} iconSize={16} dimmed={file.kind !== 'image'} onClick={() => file.kind === 'image' && onCopyImage(file)} />
      ) : null}
      <IconButton data-viewer-close="" icon={X} label="Close" size={28} iconSize={16} onClick={onClose} />
    </Surface>
  )
}

/** One item in a box fitted to the stage: the thumbnail at once, the full image fading in over it, or the video over its poster. An image zooms (`useZoom`). */
function Item({ file, position, onImageMenu }: { readonly file: MediaFile; readonly position: number; readonly onImageMenu: MediaViewerProps['onImageMenu'] }) {
  const [loaded, setLoaded] = useState(false)
  const { frame, content, zoomed } = useZoom(file.kind === 'image')
  const full = file.kind === 'image' ? file.full : undefined
  const { width = file.thumb.width, height = file.thumb.height } = file
  return (
    <div ref={frame} data-viewer-item={position} onContextMenu={file.kind === 'image' && onImageMenu !== undefined ? (event) => onImageMenu(file, event) : undefined} {...stylex.props(styles.frame, styles.fitted(width, height), zoomed && styles.zoomed)}>
      {/* One transform for both images, so the full image stays over the thumbnail. */}
      <div ref={content} data-viewer-zoom="" {...stylex.props(styles.zoom)}>
        <img src={file.thumb.src} alt="" draggable={false} decoding="async" {...stylex.props(styles.image)} />
        {full === undefined ? null : (
          <img src={full} alt={file.name} draggable={false} decoding="async" onLoad={() => setLoaded(true)} {...stylex.props(styles.image, styles.full, loaded && styles.fullShown)} />
        )}
      </div>
      {file.kind === 'video' && file.video !== undefined ? (
        <video src={file.video} poster={file.thumb.src} controls playsInline preload="metadata" aria-label={file.name} {...stylex.props(styles.image)} />
      ) : null}
    </div>
  )
}

/** A document's frame: a PDF and a CSV as wide as the stage, HTML and other text at reading width, audio a card of the bar's width. */
function documentBox(file: FileView) {
  if (file.kind === 'audio') return [styles.audioCard]
  if (file.kind === 'pdf' || file.textKind === 'csv') return [styles.document, styles.paper]
  return [styles.document, styles.paper, styles.reading]
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
  // As large as the stage: a document's size is the topic's, never its own.
  document: {
    flexGrow: 1,
    flexShrink: 1,
    alignSelf: 'stretch',
    minWidth: 0,
  },
  reading: {
    maxWidth: layout['--reading-width'],
  },
  paper: {
    backgroundColor: colors['--background'],
  },
  audioCard: {
    width: layout['--viewer-bar-width'],
    maxWidth: '100%',
    backgroundColor: colors['--surface-default'],
  },
  // As large as the picture, or as the stage allows, at the picture's aspect ratio: known before any bytes arrive.
  fitted: (width: number, height: number) => ({
    width: `min(${width}px, 100cqw, calc(100cqh * ${width} / ${height}))`,
    aspectRatio: `${width} / ${height}`,
  }),
  // Scales from its top left corner, so the zoom's arithmetic needs no offsets.
  zoom: {
    position: 'absolute',
    inset: 0,
    transformOrigin: 'top left',
  },
  zoomed: {
    cursor: { default: 'grab', ':active': 'grabbing' },
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
