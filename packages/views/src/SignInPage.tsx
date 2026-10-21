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
  /** `center` centres every line on the column (sign-in); `start` keeps them on its start edge (Set up Juno, with its form). Default `start`. */
  readonly align?: 'start' | 'center'
  readonly children: ReactNode
  readonly 'data-set-up-juno'?: ''
}

/** A window shorter than this tightens the column's rhythm, so sign-in fits without scrolling. */
const SHORT = '@media (max-height: 720px)'

/**
 * The page the window shows before the app (SPEC section 4, "Sign-in"):
 * the mark, the serif title and a line under it, the page's own controls,
 * and a status line whose room is kept, so a message never moves the
 * buttons. `SignInView` and `SetUpJunoView` share it.
 */
export function SignInPage({ titleId, title, body, status, statusAction, align = 'start', children, ...data }: SignInPageProps) {
  const centred = align === 'center'
  return (
    <section {...stylex.props(styles.root, centred && styles.rootCentred)} aria-labelledby={titleId} {...data}>
      <div {...stylex.props(styles.text, centred && styles.centred)}>
        <span {...stylex.props(styles.mark)}>
          <Logo size={40} />
        </span>
        <Text variant="pageTitle" tone="default" id={titleId}>
          {title}
        </Text>
        <Text variant="body" tone="subtle" as="p" {...(centred ? { sx: styles.pitch } : {})}>
          {body}
        </Text>
      </div>
      {children}
      <div {...stylex.props(styles.status, centred && styles.centred)} role="status" aria-live="polite">
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
  // Above the sign-in page's art, which is placed against the window.
  rootCentred: {
    position: 'relative',
    gap: { default: spacing['--space-8'], [SHORT]: spacing['--space-6'] },
    paddingBlock: { default: spacing['--space-12'], [SHORT]: spacing['--space-8'] },
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
  },
  centred: {
    alignItems: 'center',
    textAlign: 'center',
  },
  pitch: {
    maxWidth: layout['--sign-in-pitch-width'],
    textWrap: 'balance',
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
