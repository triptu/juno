import * as stylex from '@stylexjs/stylex'
import type { Ref, TextareaHTMLAttributes } from 'react'
import { accent, colors, layout, radii, spacing, text } from '@juno/tokens/tokens.stylex'

export type TextareaVariant = 'inline' | 'card'

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style' | 'className'> {
  /**
   * `inline`: no border of its own, grows with its content to a maximum and
   * then scrolls (composer). `card`: a bordered block on the page background
   * inside a card (send card).
   */
  readonly variant?: TextareaVariant
  /** For `inline`: the growth limit. */
  readonly maxHeight?: 'composer' | 'assistant'
  readonly label?: string
  /** The element, for an owner that focuses it (⌘J on the Juno composer). */
  readonly ref?: Ref<HTMLTextAreaElement>
}

/**
 * A multi-line input. The inline variant grows with its content through
 * `field-sizing: content`, so no layout is read on a keystroke.
 */
export function Textarea({ variant = 'inline', maxHeight = 'composer', label, rows, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-label={label}
      rows={rows ?? (variant === 'inline' ? 1 : 2)}
      {...rest}
      {...stylex.props(styles.base, variants[variant], variant === 'inline' && maxHeights[maxHeight])}
    />
  )
}

const styles = stylex.create({
  base: {
    display: 'block',
    width: '100%',
    margin: 0,
    boxSizing: 'border-box',
    backgroundColor: colors['--surface-default'],
    color: colors['--foreground-default'],
    outline: 'none',
    userSelect: 'text',
    cursor: 'text',
    '::placeholder': {
      color: colors['--foreground-muted'],
      opacity: 1,
    },
  },
})

const variants = stylex.create({
  inline: {
    // 9 + 22 + 9 = the 40px single-line composer.
    paddingBlock: layout['--composer-padding-block'],
    paddingInline: spacing['--space-1'],
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    lineHeight: layout['--composer-line-height'],
    letterSpacing: text['--text-body-tracking'],
    resize: 'none',
    fieldSizing: 'content',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  card: {
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2-5'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--input-border'],
      ':focus': accent['--focus-ring'],
    },
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--background'],
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    lineHeight: text['--text-body-small-leading'],
    letterSpacing: text['--text-body-tracking'],
    resize: 'none',
  },
})

const maxHeights = stylex.create({
  composer: { maxHeight: layout['--composer-max-height'] },
  assistant: { maxHeight: layout['--assistant-input-max-height'] },
})
