import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Text } from './Text'

export interface EmptyStateProps {
  readonly title: string
  /** Says why it is empty. */
  readonly body?: string
  /** One next step, usually a secondary Button. */
  readonly action?: ReactNode
  /** `workspace` uses the serif title for the no-tabs state. */
  readonly variant?: 'list' | 'workspace'
  /** `page` pads 48 all round; `list` pads 48 16. */
  readonly padding?: 'page' | 'list'
}

/** Centered title, reason and one next step. */
export function EmptyState({ title, body, action, variant = 'list', padding = 'list' }: EmptyStateProps) {
  return (
    <div {...stylex.props(styles.root, padding === 'page' ? styles.page : styles.list)}>
      {variant === 'workspace' ? (
        <Text role="emptyTitle" tone="subtle">
          {title}
        </Text>
      ) : (
        <Text role="body" weight="medium" tone="default" as="h2">
          {title}
        </Text>
      )}
      {body ? (
        <Text role="ui" tone="muted" as="p" sx={styles.body}>
          {body}
        </Text>
      ) : null}
      {action ? <div {...stylex.props(styles.action)}>{action}</div> : null}
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: spacing['--space-2'],
    userSelect: 'none',
  },
  list: {
    paddingBlock: spacing['--space-12'],
    paddingInline: spacing['--space-4'],
  },
  page: {
    padding: spacing['--space-12'],
  },
  body: {
    maxWidth: '36ch',
    textWrap: 'pretty',
  },
  action: {
    marginTop: spacing['--space-1'],
  },
})
