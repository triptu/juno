import * as stylex from '@stylexjs/stylex'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { colors, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { interactive } from './internal/interactive'
import { Text } from './Text'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'style' | 'className' | 'type' | 'size'> {
  readonly label: ReactNode
  readonly description?: ReactNode
  /** Larger label (14px) for settings rows; default 13.5px. */
  readonly size?: 'md' | 'lg'
}

/** A native 15px checkbox with a label and an optional description. */
export function Checkbox({ label, description, size = 'md', disabled, ...rest }: CheckboxProps) {
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
    outlineColor: colors['--focus-ring'],
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
