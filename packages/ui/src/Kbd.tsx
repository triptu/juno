import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, opacity, radii, spacing } from '@juno/tokens/tokens.stylex'
import { roles } from './internal/type'

export interface KbdProps {
  /** `plain` is bare muted text ("⌘J"); `key` draws a keycap ("esc"). */
  readonly look?: 'plain' | 'key'
  /** Inherit the surrounding colour at reduced opacity (inside dark buttons). */
  readonly inherit?: boolean
  readonly children: ReactNode
}

/** Keyboard hint in the mono face. */
export function Kbd({ look = 'plain', inherit = false, children }: KbdProps) {
  return (
    <kbd {...stylex.props(styles.base, roles.kbd, look === 'key' && styles.key, inherit && styles.inherit)}>
      {children}
    </kbd>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-block',
    color: colors['--foreground-muted'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
    fontVariantNumeric: 'tabular-nums',
  },
  key: {
    color: colors['--foreground-subtle'],
    paddingBlock: '1px',
    paddingInline: spacing['--space-1'],
    borderWidth: '1px',
    borderBottomWidth: '2px',
    borderStyle: 'solid',
    borderColor: colors['--border-strong'],
    borderRadius: radii['--radius-xs'],
    lineHeight: '1.2',
  },
  inherit: {
    color: 'inherit',
    opacity: opacity['--opacity-kbd'],
  },
})
