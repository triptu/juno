import * as stylex from '@stylexjs/stylex'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { accent, colors, layout, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, type PhosphorIcon } from './Icon'
import { variants as typeVariants } from './internal/type'

export type TextFieldSize = 30 | 32 | 34 | 36 | 44

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'style' | 'className' | 'size'> {
  readonly size?: TextFieldSize
  /** An icon before the text (search). */
  readonly leadingIcon?: PhosphorIcon
  /** Content before the text: the "To" label and a ContextPill. */
  readonly leading?: ReactNode
  readonly trailing?: ReactNode
  /** Width as a CSS length. Default: fill the container. */
  readonly width?: 'full' | 'search' | 'keyword'
  /** Text setting. 44px fields and 36px title inputs use larger text. */
  readonly text?: 'ui' | 'bodySmall' | 'body' | 'heading'
  /** Required when there is no visible label. */
  readonly label?: string
  /** The value failed a check: danger border, sets aria-invalid. */
  readonly invalid?: boolean
  /** The input, for an owner that moves focus to it. */
  readonly ref?: Ref<HTMLInputElement>
}

const textBySize: Record<TextFieldSize, 'ui' | 'bodySmall' | 'body' | 'heading'> = {
  30: 'ui',
  32: 'ui',
  34: 'ui',
  36: 'bodySmall',
  44: 'body',
}

/**
 * A single-line input. The container draws the border and the focus state;
 * the inner input is unstyled.
 */
export function TextField({ size = 32, leadingIcon, leading, trailing, width = 'full', text, label, invalid = false, ...rest }: TextFieldProps) {
  return (
    <label {...stylex.props(styles.field, sizeStyles[size], widths[width], invalid && styles.invalid)}>
      {leadingIcon ? (
        <span {...stylex.props(styles.icon)}>
          <Icon icon={leadingIcon} size={size >= 44 ? 18 : 16} />
        </span>
      ) : null}
      {leading}
      <input aria-label={label} aria-invalid={invalid || undefined} {...rest} {...stylex.props(styles.input, typeVariants[text ?? textBySize[size]])} />
      {trailing}
    </label>
  )
}

const styles = stylex.create({
  field: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    paddingInline: spacing['--space-2-5'],
    backgroundColor: colors['--surface-default'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--input-border'],
      ':focus-within': accent['--focus-ring'],
    },
    color: colors['--foreground-default'],
    cursor: 'text',
    minWidth: 0,
    boxSizing: 'border-box',
  },
  invalid: {
    borderColor: {
      default: colors['--danger'],
      ':focus-within': colors['--danger'],
    },
  },
  icon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  input: {
    flexGrow: 1,
    minWidth: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    letterSpacing: 'inherit',
    outline: 'none',
    '::placeholder': {
      color: colors['--foreground-muted'],
      opacity: 1,
    },
  },
})

const sizeStyles = stylex.create({
  30: { height: sizes['--control-30'], borderRadius: radii['--radius-md-plus'] },
  32: { height: sizes['--control-32'], borderRadius: radii['--radius-md-plus'] },
  34: { height: sizes['--control-34'], borderRadius: radii['--radius-lg'] },
  36: { height: sizes['--control-36'], borderRadius: radii['--radius-lg'], paddingInline: spacing['--space-3'] },
  44: { minHeight: sizes['--control-44'], borderRadius: radii['--radius-xl'], paddingInline: spacing['--space-3'], gap: spacing['--space-2-5'] },
})

const widths = stylex.create({
  full: { width: '100%' },
  search: { width: layout['--search-field-width'] },
  keyword: { width: layout['--keyword-field-width'] },
})
