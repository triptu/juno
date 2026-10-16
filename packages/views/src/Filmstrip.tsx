/**
 * The media viewer's filmstrip (`MediaViewer`): every image and video of the
 * message along the bottom, in order, the current one marked.
 */
import * as stylex from '@stylexjs/stylex'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { useEffect, useRef } from 'react'
import { accent, colors, layout, motion, opacity, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Icon } from '@juno/ui'
import type { MediaFile } from './MediaGrid'

interface FilmstripProps {
  readonly items: ReadonlyArray<MediaFile>
  readonly index: number
  readonly onShow: (index: number) => void
}

/** Every item of the message along the bottom, the current one marked and kept in view. Images load as they scroll into view. */
export function Filmstrip({ items, index, onShow }: FilmstripProps) {
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    strip.current?.children[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [index])
  return (
    <div ref={strip} role="group" aria-label="All pictures in this message" data-filmstrip="" {...stylex.props(styles.strip)}>
      {items.map((item, at) => (
        <button
          key={at}
          type="button"
          aria-label={`Show ${item.name}`}
          aria-current={at === index ? 'true' : undefined}
          title={item.name}
          data-filmstrip-item={at + 1}
          onClick={() => onShow(at)}
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
  )
}

const styles = stylex.create({
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
