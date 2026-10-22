import * as stylex from '@stylexjs/stylex'
import { fonts, sizes } from '@juno/tokens/tokens.stylex'

/** Square size in px: 14 in chips and the hover toolbar, 16 in quick-reaction pills, 20 in the picker, 32 in the reactors card. */
type EmojiSize = 14 | 16 | 20 | 32

export interface EmojiProps {
  /** A standard emoji as text. A `:name:` with no image is plain text, not an `Emoji`. */
  readonly glyph: string
  readonly size?: EmojiSize
}

/**
 * A text emoji in a square of its size, set in the emoji font with
 * line-height 1, so a flex parent centres the emoji itself. In Figtree's line
 * box an emoji draws off the centre line, and its advance (1.28em in Apple
 * Color Emoji) is wider than the emoji, which put it left of centre. The
 * extra advance runs out of the square to the right, unseen. Hidden from
 * assistive technology: the parent names it.
 */
export function Emoji({ glyph, size = 14 }: EmojiProps) {
  'use no memo' // A leaf in every reaction chip; the compiler's cache would only add bytes to the start bundle.
  return (
    <span aria-hidden {...stylex.props(styles.glyph, sizeStyles[size])}>
      {glyph}
    </span>
  )
}

const styles = stylex.create({
  glyph: {
    display: 'inline-block',
    flexShrink: 0,
    width: '1em', // tokens-allow: the square is the font size
    height: '1em', // tokens-allow: the square is the font size
    fontFamily: fonts['--font-emoji'],
    lineHeight: 1,
  },
})

const sizeStyles = stylex.create({
  14: { fontSize: sizes['--icon-14'], transform: `translateY(${sizes['--emoji-14-shift']})` },
  16: { fontSize: sizes['--icon-16'], transform: `translateY(${sizes['--emoji-16-shift']})` },
  20: { fontSize: sizes['--icon-20'], transform: `translateY(${sizes['--emoji-20-shift']})` },
  32: { fontSize: sizes['--control-32'], transform: `translateY(${sizes['--emoji-32-shift']})` },
})
