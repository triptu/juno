import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { accent, layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Text, type ActivateEvent } from '@juno/ui'
import { HomeScene } from './HomeScene'
import { PictureImage, pictureLift } from './PictureImage'

/** Home's picture (SPEC 12, "A picture"): already on this Mac, with what its caption says. */
export interface HomePictureView {
  readonly src: string
  readonly title: string
  readonly artist: string
  readonly date: string
  /** Width over height. */
  readonly ratio: number
}

export interface HomePictureProps {
  readonly picture: HomePictureView
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onOpen: (event: ActivateEvent) => void
  /** The file would not load: the box shows the caught-up scene instead, at the same size. */
  readonly onMissing?: () => void
}

/**
 * The picture in the caught-up scene's place, and its caption: the title
 * in the subtle tone, then "artist, date" smaller and muted, one line each. The box is the same for every picture (lower on a shorter
 * window), so the caption is always in one place; the picture is fitted
 * inside and rests on the box's bottom edge, over the caption.
 */
export function HomePicture({ picture, onOpen, onMissing }: HomePictureProps) {
  const [missing, setMissing] = useState(false)
  return (
    <div data-home-picture="" {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.box)}>
        {missing ? (
          <HomeScene name="caughtUp" />
        ) : (
          <button
            type="button"
            aria-label={`Open ${picture.title}`}
            {...activateHandlers<HTMLButtonElement>(onOpen)}
            {...stylex.props(styles.frame, styles.width(picture.ratio), pictureLift)}
          >
            <PictureImage
              src={picture.src}
              ratio={picture.ratio}
              onError={() => {
                setMissing(true)
                onMissing?.()
              }}
            />
          </button>
        )}
      </div>
      <div data-home-caption="" {...stylex.props(styles.caption)}>
        <Text variant="ui" tone="subtle" as="p" truncate tooltipWhenTruncated>
          {picture.title}
        </Text>
        <Text variant="meta" tone="muted" as="p" truncate tooltipWhenTruncated>
          {picture.artist}, {picture.date}
        </Text>
      </div>
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    maxWidth: layout['--home-width'],
  },
  // The box's height, read by the frame's width so a picture never overflows it.
  box: {
    // Home's own height (a size container) less what the rest of the page takes, so the column fits on a shorter window.
    '--home-picture-h': `clamp(${sizes['--home-picture-height-min']}, calc(100cqh - ${sizes['--home-picture-room']}), ${sizes['--home-picture-height']})`,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    width: sizes['--home-picture-width'],
    maxWidth: '100%',
    height: 'var(--home-picture-h)',
  },
  frame: {
    display: 'block',
    flexShrink: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
  },
  // As wide as the box allows at the picture's shape: the full width, or less for a tall picture.
  width: (ratio: number) => ({ width: `min(100%, calc(var(--home-picture-h) * ${ratio}))` }),
  // Two lines, never more: each takes an ellipsis inside the box's width, with the whole line as its tooltip.
  caption: {
    width: sizes['--home-picture-width'],
    maxWidth: '100%',
    marginTop: spacing['--space-3'],
    textAlign: 'center',
  },
})
