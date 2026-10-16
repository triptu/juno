import * as stylex from '@stylexjs/stylex'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { FileView } from '@juno/contract'
import { accent, colors, layout, motion, opacity, radii, sizes, spacing, z } from '@juno/tokens/tokens.stylex'
import { Icon, IconButton, Surface, Text } from '@juno/ui'
import type { MediaFile } from './FileCard'
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
  /** With it, and a `download` url on the item, the header has Download. */
  readonly onDownload?: ((file: FileView) => void) | undefined
  /** With it, and a `download` url on the item, the header has Open: the default app (Preview for images). */
  readonly onOpenFile?: ((file: FileView) => void) | undefined
  /** With it, an image has Copy image. */
  readonly onCopyImage?: ((file: FileView) => void) | undefined
}

/**
 * A message's images and videos over the whole window (inventory 6): a dim
 * backdrop, the current item fitted inside the window in a box sized from its
 * own dimensions, a header with its name, the sender and time and its
 * actions, and along the bottom a filmstrip of every item, the current one
 * marked. ← and →, the side arrows and the strip move through them; Home and
 * End go to the ends. The thumbnail shows at once and the full image fades in
 * over it when it arrives, so nothing moves while it loads; a new item fades
 * in (`--duration-fast`, none with reduced motion), and its neighbours'
 * full images are fetched ahead. Opens in one frame with focus on Close,
 * keeps Tab inside, and gives focus back to what had it when it closes.
 * Mount it outside the message rows: their paint containment would clip a
 * fixed element.
 */
export function MediaViewer({ viewing, now, onClose, onDownload, onOpenFile, onCopyImage }: MediaViewerProps) {
  const { items } = viewing
  const root = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(() => Math.min(Math.max(0, viewing.index), items.length - 1))
  const [loaded, setLoaded] = useState<string | undefined>(undefined)
  const file = items[index]!
  const several = items.length > 1

  useEffect(() => {
    const opener = document.activeElement
    root.current?.querySelector<HTMLElement>('[data-viewer-close]')?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  // The neighbours' full images are fetched ahead, so moving to them shows them sharp at once.
  useEffect(() => {
    for (const near of [items[index - 1], items[index + 1]]) {
      if (near?.full === undefined) continue
      const image = new Image()
      image.decoding = 'async'
      image.src = near.full
    }
    strip.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [items, index])

  const go = (next: number) => setIndex(Math.min(Math.max(0, next), items.length - 1))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    // A playing video keeps its own keys.
    const inVideo = event.target instanceof HTMLVideoElement
    const move = inVideo ? undefined : { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: items.length - 1 }[event.key]
    if (move !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      go(move)
      return
    }
    if (event.key !== 'Tab') return
    // Focus stays inside the viewer: Tab goes round its controls.
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, video'))
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  // A click on the dim around the picture, the bar or the strip closes; one on the picture or a button does not.
  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }

  const width = file.width ?? file.thumb.width
  const height = file.height ?? file.thumb.height
  const full = file.kind === 'image' ? file.full : undefined
  const canDownload = file.download !== undefined
  const anyDownload = items.some((item) => item.download !== undefined)
  const anyImage = items.some((item) => item.kind === 'image')
  const meta = [viewing.sender, messageTime(viewing.at, now), ...(several ? [`${index + 1} of ${items.length}`] : [])].join(' · ')
  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label={file.name} data-media-viewer="" onKeyDown={onKeyDown} onClick={onBackdrop} {...stylex.props(styles.backdrop)}>
      <div onClick={onBackdrop} {...stylex.props(styles.bar)}>
        <Surface kind="toolbar" padding="xs" sx={styles.barSurface}>
          <span {...stylex.props(styles.heading)}>
            <Text variant="ui" weight="medium" tone="default" truncate dir="auto" data-sensitive="" data-viewer-name="">
              {file.name}
            </Text>
            <Text variant="meta" tone="muted" truncate numeric title={fullTime(viewing.at)} data-viewer-meta="">
              {meta}
            </Text>
          </span>
          {/* The same buttons for every item, so the bar never moves; one that does not apply to this item is dimmed. */}
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
      </div>
      <div onClick={onBackdrop} {...stylex.props(styles.stage)}>
        <div onClick={onBackdrop} {...stylex.props(styles.fit)}>
          {/* Keyed by item: a new one fades in, and its full image starts unloaded. */}
          <div key={index} data-viewer-item={index + 1} {...stylex.props(styles.frame, styles.fitted(width, height))}>
            <img src={file.thumb.src} alt="" draggable={false} decoding="async" {...stylex.props(styles.image)} />
            {full === undefined ? null : (
              <img src={full} alt={file.name} draggable={false} decoding="async" onLoad={() => setLoaded(full)} {...stylex.props(styles.image, styles.full, loaded === full && styles.fullShown)} />
            )}
            {file.kind === 'video' && file.video !== undefined ? (
              <video src={file.video} poster={file.thumb.src} controls playsInline preload="metadata" aria-label={file.name} {...stylex.props(styles.image)} />
            ) : null}
          </div>
        </div>
        {several ? (
          <>
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
          <div ref={strip} role="group" aria-label="All pictures in this message" data-filmstrip="" {...stylex.props(styles.strip)}>
            {items.map((item, at) => (
              <button
                key={at}
                type="button"
                aria-label={`Show ${item.name}`}
                aria-current={at === index ? 'true' : undefined}
                title={item.name}
                data-filmstrip-item={at + 1}
                onClick={() => go(at)}
                {...stylex.props(styles.stripItem, at === index && styles.stripCurrent)}
              >
                <img src={item.thumb.src} alt="" draggable={false} decoding="async" loading="lazy" {...stylex.props(styles.stripImage)} />
                {at === index ? <span {...stylex.props(styles.stripRing)} /> : null}
                {item.kind === 'video' ? (
                  <span {...stylex.props(styles.stripPlay)}>
                    <Icon icon={Play} size={12} weight="fill" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const enter = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: z['--z-viewer'],
    // Over the title bars' drag strips, which would otherwise take the press (as the palette's overlay).
    WebkitAppRegion: 'no-drag',
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
  // Its size is what the window leaves, never the picture's.
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
  strip: {
    display: 'flex',
    gap: spacing['--space-1-5'],
    maxWidth: '100%',
    overflowX: 'auto',
    overscrollBehavior: 'contain',
    // Room for the focus ring and the current item's ring inside the scroller.
    padding: spacing['--space-1'],
    scrollbarWidth: 'none',
  },
  stripItem: {
    position: 'relative',
    flexShrink: 0,
    width: layout['--filmstrip-thumb'],
    height: layout['--filmstrip-thumb'],
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-lg'],
    overflow: 'hidden',
    backgroundColor: colors['--secondary-default'],
    cursor: 'default',
    opacity: {
      default: opacity['--opacity-dim'],
      ':hover': 1,
    },
    transitionProperty: 'opacity',
    transitionDuration: motion['--duration-fast'],
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
  },
  // The current item: at full strength, with the accent drawn inside its edge (the focus ring stays outside).
  stripCurrent: {
    opacity: 1,
  },
  stripRing: {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    boxShadow: `inset 0 0 0 ${sizes['--focus-ring-width']} ${accent['--hl']}`,
  },
  stripImage: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  stripPlay: {
    position: 'absolute',
    insetBlockEnd: spacing['--space-1'],
    insetInlineEnd: spacing['--space-1'],
    display: 'flex',
    padding: spacing['--space-0-5'],
    borderRadius: radii['--radius-full'],
    backgroundColor: colors['--media-scrim'],
    color: colors['--media-scrim-foreground'],
  },
})
