import * as stylex from '@stylexjs/stylex'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { accent, colors, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { interactive } from './internal/interactive'
import { Text } from './Text'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'style' | 'className' | 'type' | 'size'> {
  readonly label: ReactNode
  readonly description?: ReactNode
  /** Larger label (14px) for settings rows; default 13.5px. */
  readonly size?: 'md' | 'lg'
  /** In a table whose column header names it: the label is only the accessible name. */
  readonly labelHidden?: boolean
}

/** A native 15px checkbox with a label and an optional description. */
export function Checkbox({ label, description, size = 'md', labelHidden = false, disabled, ...rest }: CheckboxProps) {
  if (labelHidden) {
    return (
      <span {...stylex.props(styles.bare, disabled && interactive.dimmed)}>
        <input type="checkbox" aria-label={typeof label === 'string' ? label : undefined} disabled={disabled} {...rest} {...stylex.props(styles.input, styles.bareInput)} />
      </span>
    )
  }
  return (
    <label {...stylex.props(styles.root, disabled && interactive.dimmed)}>
      <input type="checkbox" disabled={disabled} {...rest} {...stylex.props(styles.input)} />
      <span {...stylex.props(styles.text)}>
        <Text variant={size === 'lg' ? 'body' : 'bodySmall'} weight="medium" tone="default" as="span">
          {label}
        </Text>
        {description !== undefined ? (
          <Text variant={size === 'lg' ? 'ui' : 'meta'} tone="muted" as="span" sx={styles.description}>
            {description}
          </Text>
        ) : null}
      </span>
    </label>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-2-5'],
    userSelect: 'none',
    minWidth: 0,
  },
  bare: {
    display: 'inline-flex',
    alignItems: 'center',
  },
  bareInput: {
    marginTop: 0,
  },
  input: {
    appearance: 'auto',
    width: sizes['--checkbox'],
    height: sizes['--checkbox'],
    margin: 0,
    marginTop: spacing['--space-0-5'],
    flexShrink: 0,
    accentColor: colors['--foreground-default'],
    cursor: 'default',
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    minWidth: 0,
  },
  description: {
    lineHeight: text['--text-preview-leading'],
  },
})
