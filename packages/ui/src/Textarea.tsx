import * as stylex from '@stylexjs/stylex'
import { useCallback, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'
import { colors, layout, radii, spacing, text } from '@juno/tokens/tokens.stylex'

export type TextareaVariant = 'plain' | 'inline' | 'card'

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style' | 'className'> {
  /**
   * `plain`: bordered block that resizes vertically (New message).
   * `inline`: no border of its own, grows with its content to a maximum and
   * then scrolls (composer). `card`: a bordered block on the page background
   * inside a card (send card).
   */
  readonly variant?: TextareaVariant
  /** For `inline`: the growth limit. */
  readonly maxHeight?: 'composer' | 'assistant'
  readonly label?: string
}

/** A multi-line input. */
export function Textarea({ variant = 'plain', maxHeight = 'composer', label, rows, onInput, ...rest }: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const fit = useCallback(() => {
    const node = ref.current
    if (!node || variant !== 'inline') return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [variant])

  useLayoutEffect(fit, [fit, rest.value, rest.defaultValue])

  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={rows ?? (variant === 'inline' ? 1 : variant === 'card' ? 2 : 6)}
      onInput={(event) => {
        fit()
        onInput?.(event)
      }}
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
  plain: {
    paddingBlock: spacing['--space-3'],
    paddingInline: spacing['--space-3-5'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--input-border'],
      ':focus': colors['--focus-ring'],
    },
    boxShadow: {
      default: 'none',
      ':focus': `0 0 0 1px ${colors['--focus-ring']}`,
    },
    borderRadius: radii['--radius-xl'],
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    lineHeight: text['--text-body-leading'],
    letterSpacing: text['--text-body-tracking'],
    resize: 'vertical',
  },
  inline: {
    // 9 + 22 + 9 = the 40px single-line composer. Component-local value.
    paddingBlock: '9px',
    paddingInline: spacing['--space-1'],
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    lineHeight: '22px',
    letterSpacing: text['--text-body-tracking'],
    resize: 'none',
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
      ':focus': colors['--focus-ring'],
    },
    boxShadow: {
      default: 'none',
      ':focus': `0 0 0 1px ${colors['--focus-ring']}`,
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
