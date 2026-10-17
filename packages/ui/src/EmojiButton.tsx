import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes } from 'react'
import { colors, radii, sizes } from '@juno/tokens/tokens.stylex'
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

// The emoji is drawn a step larger than the toolbar's 18px icons, since a
// glyph fills less of its box than a Phosphor icon. The button is the 28px
// hover-toolbar control (radius 12 inside the toolbar's 16).
const EMOJI_SIZE = '16px' // tokens-allow: an emoji glyph's size, not a control

/**
 * A 28px ghost button whose icon is an emoji: the quick reactions in the
 * hover toolbar and the picker's cells. Same feedback as `IconButton`.
 */
export function EmojiButton({ emoji, src, label, noTooltip = false, type = 'button', ...rest }: EmojiButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      {...(noTooltip ? {} : tooltip(label))}
      {...rest}
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
    width: sizes['--control-28'],
    height: sizes['--control-28'],
    borderRadius: radii['--radius-xl'],
    verticalAlign: 'middle',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  glyph: {
    fontSize: EMOJI_SIZE,
    lineHeight: 1,
  },
  image: {
    width: EMOJI_SIZE,
    height: EMOJI_SIZE,
    objectFit: 'contain',
  },
})
