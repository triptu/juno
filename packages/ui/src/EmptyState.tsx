import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { motion, spacing } from '@juno/tokens/tokens.stylex'
import { Illustration, type IllustrationName } from './illustrations/Illustration'
import { Text } from './Text'

export interface EmptyStateProps {
  readonly title: string
  /** Says why it is empty. */
  readonly body?: string
  /** One next step, usually a secondary Button. */
  readonly action?: ReactNode
  /** A spot illustration above the title: 96 wide in `list`, 120 in `workspace`. */
  readonly illustration?: IllustrationName
  /** `workspace` uses the serif title for the no-tabs state. */
  readonly variant?: 'list' | 'workspace'
  /** `page` pads 48 all round; `list` pads 48 16. */
  readonly padding?: 'page' | 'list'
  /**
   * Play the staggered entrance (illustration, title, action 80ms apart)
   * when the state mounts. Pass false when it was visible less than a
   * second ago, so a filter change just shows it.
   */
  readonly enter?: boolean
}

/** Centered illustration, title, reason and one next step. */
export function EmptyState({ title, body, action, illustration, variant = 'list', padding = 'list', enter = true }: EmptyStateProps) {
  // Each shown part enters one stagger step after the one above it.
  const titleStep = illustration ? 1 : 0
  const bodyStep = titleStep + 1
  const actionStep = bodyStep + (body ? 1 : 0)
  const part = (step: number) => (enter ? [styles.rise, styles.delay(step)] : [])
  return (
    <div {...stylex.props(styles.root, padding === 'page' ? styles.page : styles.list)}>
      {illustration ? (
        <div {...stylex.props(styles.illustration, ...part(0))}>
          <Illustration name={illustration} size={illustration === 'juno' ? 'figure' : variant === 'workspace' ? 'workspace' : 'list'} />
        </div>
      ) : null}
      {variant === 'workspace' ? (
        <Text variant="emptyTitle" tone="subtle" sx={part(titleStep)}>
          {title}
        </Text>
      ) : (
        <Text variant="body" weight="medium" tone="default" as="h2" sx={part(titleStep)}>
          {title}
        </Text>
      )}
      {body ? (
        <Text variant="ui" tone="muted" as="p" sx={[styles.body, ...part(bodyStep)]}>
          {body}
        </Text>
      ) : null}
      {action ? <div {...stylex.props(styles.action, ...part(actionStep))}>{action}</div> : null}
    </div>
  )
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: `translateY(${motion['--rise-stagger']})` },
  to: { opacity: 1, transform: 'translateY(0)' },
})

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
  illustration: {
    // 14px between the drawing and the title: the 8px gap plus this.
    marginBottom: spacing['--space-1-5'],
  },
  body: {
    maxWidth: '36ch',
    textWrap: 'pretty',
  },
  action: {
    marginTop: spacing['--space-1'],
  },
  rise: {
    animationName: rise,
    animationDuration: motion['--duration-appear'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  delay: (step: number) => ({
    animationDelay: `calc(${motion['--stagger']} * ${step})`,
  }),
})
