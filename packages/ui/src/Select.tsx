import { menuTriggerHandlers } from './menuTrigger'
import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from 'react'
import { accent, colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { variants as typeVariants } from './internal/type'

export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'style' | 'className' | 'size'> {
  readonly options: ReadonlyArray<SelectOption>
  readonly size?: 28 | 30 | 32
  readonly label?: string
}

/** A native select styled like a 28, 30 or 32px field, as wide as its longest option. The menu is the OS's. */
export function Select({ options, size = 32, label, ...rest }: SelectProps) {
  return (
    <select aria-label={label} {...rest} {...stylex.props(styles.select, typeVariants.ui, sizeStyles[size])}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export interface SelectButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'children'> {
  readonly ref?: Ref<HTMLButtonElement>
  readonly size?: 28 | 30 | 32
  /** Before the value: the chosen item's icon. */
  readonly leading?: ReactNode
  /** Nothing chosen yet: `children` is the prompt, in the muted tone. */
  readonly placeholder?: boolean
  /** The list is showing: `aria-expanded`. */
  readonly expanded?: boolean
  /** As wide as its box (a grid cell), not its value. */
  readonly fill?: boolean
  readonly children: ReactNode
}

/**
 * A button drawn like `Select`, for a list Juno draws itself (a searchable
 * list in a `Popover`), where the OS menu cannot filter. It shrinks with its
 * row and cuts a long value with an ellipsis.
 */
export function SelectButton({ ref, size = 32, leading, placeholder = false, expanded, fill = false, children, type = 'button', ...rest }: SelectButtonProps) {
  return (
    <button ref={ref} type={type} aria-haspopup="dialog" aria-expanded={expanded} {...rest} {...menuTriggerHandlers({ ...rest, 'aria-haspopup': 'dialog' })} {...stylex.props(styles.select, styles.button, typeVariants.ui, sizeStyles[size], placeholder && styles.placeholder, fill && styles.fill)}>
      {leading === undefined ? null : <span {...stylex.props(styles.leading)}>{leading}</span>}
      <span {...stylex.props(styles.value)}>{children}</span>
    </button>
  )
}

const styles = stylex.create({
  select: {
    appearance: 'none',
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: spacing['--space-2-5'],
    paddingInlineEnd: spacing['--space-6'],
    backgroundColor: colors['--surface-default'],
    color: colors['--foreground-default'],
    fontFamily: 'inherit',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--input-border'],
    borderRadius: radii['--radius-md-plus'],
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
    // A chevron drawn in the muted text colour.
    backgroundImage:
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23706E66' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")",
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `right ${spacing['--space-2']} center`,
    backgroundSize: `${sizes['--icon-12']} ${sizes['--icon-12']}`,
    userSelect: 'none',
    maxWidth: '100%',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
    textAlign: 'start',
    cursor: 'default',
  },
  placeholder: {
    color: colors['--foreground-muted'],
  },
  fill: {
    width: '100%',
  },
  leading: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  value: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
})

const sizeStyles = stylex.create({
  28: { height: sizes['--control-28'] },
  30: { height: sizes['--control-30'] },
  32: { height: sizes['--control-32'] },
})
