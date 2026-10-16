import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { Logo, Text } from '@juno/ui'

export interface SignInPageProps {
  /** The heading's id, which names the section. */
  readonly titleId: string
  readonly title: string
  readonly body: string
  /** One line under the actions: what is happening (muted) or what went wrong. Its room is kept. */
  readonly status?: { readonly text: string; readonly tone: 'muted' | 'danger' }
  /** A quiet control beside the status line, such as "Copy details". */
  readonly statusAction?: ReactNode
  readonly children: ReactNode
  readonly 'data-set-up-juno'?: ''
}

/**
 * The page the window shows before the app (SPEC section 4, "Sign-in"):
 * the mark, the serif title and a line under it, the page's own controls,
 * and a status line whose room is kept, so a message never moves the
 * buttons. `SignInView` and `SetUpJunoView` share it.
 */
export function SignInPage({ titleId, title, body, status, statusAction, children, ...data }: SignInPageProps) {
  return (
    <section {...stylex.props(styles.root)} aria-labelledby={titleId} {...data}>
      <div {...stylex.props(styles.text)}>
        <span {...stylex.props(styles.mark)}>
          <Logo size={40} />
        </span>
        <Text variant="pageTitle" tone="default" id={titleId}>
          {title}
        </Text>
        <Text variant="body" tone="subtle" as="p">
          {body}
        </Text>
      </div>
      {children}
      <div {...stylex.props(styles.status)} role="status" aria-live="polite">
        {status === undefined ? null : (
          <Text variant="ui" tone={status.tone} as="p" {...(status.tone === 'danger' ? { 'data-sign-in-error': '' } : {})}>
            {status.text}
          </Text>
        )}
        {statusAction}
      </div>
    </section>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-8'],
    width: '100%',
    maxWidth: layout['--page-width-narrow'],
    alignSelf: 'center',
    marginBlock: 'auto',
    paddingBlock: spacing['--space-12'],
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
  },
  mark: {
    display: 'inline-flex',
    color: colors['--foreground-default'],
    marginBottom: spacing['--space-2'],
  },
  status: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
    minHeight: spacing['--space-6'],
  },
})
