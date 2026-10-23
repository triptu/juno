import * as stylex from '@stylexjs/stylex'
import type { ReactEventHandler } from 'react'
import { fonts, sizes } from '@juno/tokens/tokens.stylex'

/** Square size in px, or `inline` to follow the surrounding text. */
type EmojiSize = 14 | 16 | 20 | 32 | 'inline'

interface EmojiBaseProps {
  readonly size?: EmojiSize
  /** Give inline message emoji their own accessible name. Other surfaces name the parent. */
  readonly label?: string
  readonly title?: string
}

export type EmojiProps = EmojiBaseProps & (
  | {
      /** A standard emoji as text. A `:name:` with no image is plain text, not an `Emoji`. */
      readonly glyph: string
      readonly url?: never
      readonly loading?: never
      readonly onError?: never
    }
  | {
      /** A standard image emoji or a workspace custom emoji. */
      readonly url: string
      readonly glyph?: never
      readonly loading?: 'eager' | 'lazy'
      readonly onError?: ReactEventHandler<HTMLImageElement>
    }
)

/**
 * A text or image emoji in one square box. Text uses the emoji font and a
 * measured optical shift inside the box; images fill the same box without
 * moving it. Hidden from assistive technology unless `label` names inline
 * message content.
 */
export function Emoji(props: EmojiProps) {
  'use no memo' // A leaf in every reaction chip; the compiler's cache would only add bytes to the start bundle.
  const { size = 14, label, title } = props
  return (
    <span
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      role={label === undefined ? undefined : 'img'}
      title={title}
      {...stylex.props(styles.box, sizeStyles[size], size === 'inline' && styles.inline)}
    >
      {'url' in props ? (
        <img src={props.url} alt="" draggable={false} decoding="async" loading={props.loading} onError={props.onError} {...stylex.props(styles.image)} />
      ) : (
        <span {...stylex.props(styles.glyph, shiftStyles[size])}>{props.glyph}</span>
      )}
    </span>
  )
}

const styles = stylex.create({
  box: {
    display: 'inline-block',
    flexShrink: 0,
    width: '1em', // tokens-allow: the square is the font size
    height: '1em', // tokens-allow: the square is the font size
    lineHeight: 1,
  },
  inline: {
    verticalAlign: 'text-bottom',
  },
  glyph: {
    display: 'block',
    width: '1em', // tokens-allow: the glyph uses its square's size
    height: '1em', // tokens-allow: the glyph uses its square's size
    fontFamily: fonts['--font-emoji'],
    lineHeight: 1,
  },
  image: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
})

const sizeStyles = stylex.create({
  14: { fontSize: sizes['--icon-14'] },
  16: { fontSize: sizes['--icon-16'] },
  20: { fontSize: sizes['--icon-20'] },
  32: { fontSize: sizes['--control-32'] },
  inline: { fontSize: 'inherit' },
})

const shiftStyles = stylex.create({
  14: { transform: `translateY(${sizes['--emoji-14-shift']})` },
  16: { transform: `translateY(${sizes['--emoji-16-shift']})` },
  20: { transform: `translateY(${sizes['--emoji-20-shift']})` },
  32: { transform: `translateY(${sizes['--emoji-32-shift']})` },
  inline: {},
})
