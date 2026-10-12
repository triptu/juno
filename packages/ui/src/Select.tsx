import * as stylex from '@stylexjs/stylex'
import type { SelectHTMLAttributes } from 'react'
import { colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { roles } from './internal/type'

export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'style' | 'className' | 'size'> {
  readonly options: ReadonlyArray<SelectOption>
  readonly size?: 30 | 32
  readonly label?: string
}

/** A native select styled like a 30 or 32px field. The menu is the OS's. */
export function Select({ options, size = 32, label, ...rest }: SelectProps) {
  return (
    <select aria-label={label} {...rest} {...stylex.props(styles.select, roles.ui, sizeStyles[size])}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
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
    outlineColor: colors['--focus-ring'],
    // A chevron drawn in the muted text colour.
    backgroundImage:
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23706E66' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")",
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `right ${spacing['--space-2']} center`,
    backgroundSize: '12px 12px',
    userSelect: 'none',
    maxWidth: '100%',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
})

const sizeStyles = stylex.create({
  30: { height: sizes['--control-30'] },
  32: { height: sizes['--control-32'] },
})
