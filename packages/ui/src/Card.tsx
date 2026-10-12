import * as stylex from '@stylexjs/stylex'
import { X, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { Surface } from './Surface'
import { Text } from './Text'

export interface CardProps {
  /** Header line: kind icon and name, then an optional source. */
  readonly kindIcon?: LucideIcon
  readonly kind?: string
  readonly sourceIcon?: LucideIcon
  readonly source?: string
  readonly title?: string
  readonly body?: ReactNode
  /** Extra block between the body and the actions (prompt, options). */
  readonly children?: ReactNode
  /** Buttons, rendered in a wrapping row. */
  readonly actions?: ReactNode
  readonly onDismiss?: () => void
  readonly dismissLabel?: string
}

/**
 * A For you or assistant card: a meta header, a title, body text, an
 * optional block and a row of actions.
 */
export function Card({ kindIcon, kind, sourceIcon, source, title, body, children, actions, onDismiss, dismissLabel = 'Dismiss' }: CardProps) {
  const hasHeader = kind !== undefined || source !== undefined || onDismiss !== undefined
  return (
    <Surface kind="card" as="article" sx={styles.card}>
      {hasHeader ? (
        <div {...stylex.props(styles.header)}>
          {kindIcon ? <Icon icon={kindIcon} size={13} /> : null}
          {kind ? (
            <Text role="meta" weight="medium" tone="subtle">
              {kind}
            </Text>
          ) : null}
          {kind && source ? <span aria-hidden>·</span> : null}
          {sourceIcon ? <Icon icon={sourceIcon} size={11} /> : null}
          {source ? (
            <Text role="meta" tone="muted" truncate>
              {source}
            </Text>
          ) : null}
          {onDismiss ? (
            <span {...stylex.props(styles.dismiss)}>
              <IconButton icon={X} label={dismissLabel} size={22} radius="sm" iconSize={12} tone="muted" onClick={onDismiss} />
            </span>
          ) : null}
        </div>
      ) : null}
      {title ? (
        <Text role="heading" tone="default">
          {title}
        </Text>
      ) : null}
      {body !== undefined ? (
        <Text role="bodySmall" tone="subtle">
          {body}
        </Text>
      ) : null}
      {children}
      {actions ? <div {...stylex.props(styles.actions)}>{actions}</div> : null}
    </Surface>
  )
}

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2-5'],
    paddingBlock: spacing['--space-3-5'],
    paddingInline: spacing['--space-4'],
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    color: colors['--foreground-muted'],
    userSelect: 'none',
  },
  dismiss: {
    display: 'inline-flex',
    marginInlineStart: 'auto',
    flexShrink: 0,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
  },
})
