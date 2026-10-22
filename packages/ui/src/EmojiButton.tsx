import { menuTriggerHandlers } from './menuTrigger'
import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes } from 'react'
import { colors, fonts, radii, sizes } from '@juno/tokens/tokens.stylex'
import { focusRing } from './focusRing'
import { interactive } from './internal/interactive'
import { tooltip } from './Tooltip'

const HOVER = '@media (hover: hover)'

export interface EmojiButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'children'> {
  /** The emoji as text. Custom emoji pass `src` instead and keep this as the alt. */
  readonly emoji: string
  /** A custom emoji's image. */
  readonly src?: string
  /** Required accessible name, for example "React 👍". Also the tooltip. */
  readonly label: string
  readonly noTooltip?: boolean
}

/**
 * A 24px round ghost button whose icon is an emoji: the quick reactions in
 * the hover toolbar, the same size as its icon buttons. The emoji is 14px,
 * a step under the toolbar's 15px icons, since a colour glyph reads larger
 * than a Phosphor outline. Same feedback as `IconButton`.
 *
 * The emoji is set in the emoji font in a 14px square, so flex centres the
 * square, not Figtree's line box: in Figtree's line the emoji drew 1.25px
 * high, and its 18px advance put it 2px left of centre.
 */
export function EmojiButton({ emoji, src, label, noTooltip = false, type = 'button', ...rest }: EmojiButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      {...(noTooltip ? {} : tooltip(label))}
      {...rest}
      {...menuTriggerHandlers(rest)}
      {...stylex.props(interactive.reset, interactive.feedback, interactive.press, focusRing.outside, styles.base)}
    >
      {src === undefined ? (
        <span aria-hidden {...stylex.props(styles.glyph)}>
          {emoji}
        </span>
      ) : (
        <img src={src} alt="" draggable={false} decoding="async" {...stylex.props(styles.image)} />
      )}
    </button>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-24'],
    height: sizes['--control-24'],
    borderRadius: radii['--radius-full'],
    verticalAlign: 'middle',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  // The emoji's advance is wider than its square; the extra runs out of the box to the right, unseen.
  glyph: {
    width: sizes['--icon-14'],
    height: sizes['--icon-14'],
    fontFamily: fonts['--font-emoji'],
    fontSize: sizes['--icon-14'],
    lineHeight: 1,
    transform: `translateY(${sizes['--emoji-14-shift']})`,
  },
  image: {
    width: sizes['--icon-14'],
    height: sizes['--icon-14'],
    objectFit: 'contain',
  },
})
