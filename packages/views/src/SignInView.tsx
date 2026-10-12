import * as stylex from '@stylexjs/stylex'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'

export interface SignInViewProps {
  /** `first-run` has never signed in; `expired` had a session Slack no longer accepts. */
  readonly mode: 'first-run' | 'expired'
  /** Which action is in progress, if any. Both buttons wait while one runs. */
  readonly busy?: 'window' | 'import'
  /** One short sentence about the last failed attempt. */
  readonly error?: string
  readonly onSignIn: () => void
  readonly onImport: () => void
}

/**
 * The page shown when there is no usable session: the serif title, one
 * primary action that opens Slack's sign-in, one secondary action that reads
 * the installed Slack app's session, and a quiet line for what went wrong.
 */
export function SignInView({ mode, busy, error, onSignIn, onImport }: SignInViewProps) {
  const waiting = busy !== undefined
  return (
    <section {...stylex.props(styles.root)} aria-labelledby="sign-in-title">
      <div {...stylex.props(styles.text)}>
        <Text variant="pageTitle" tone="default" id="sign-in-title">
          {mode === 'expired' ? 'Sign in again' : 'Welcome to Juno'}
        </Text>
        <Text variant="body" tone="subtle" as="p">
          {mode === 'expired'
            ? 'Slack no longer accepts the saved session. Your topics and settings are kept.'
            : 'Juno reads your Slack workspace and organises it by topic. Sign in to connect it.'}
        </Text>
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button variant="primary" size="2xl" onClick={onSignIn} disabled={waiting}>
          Sign in to Slack
        </Button>
        <div {...stylex.props(styles.secondary)}>
          <Button variant="outline" size="2xl" onClick={onImport} disabled={waiting}>
            Use the Slack app's session
          </Button>
          <Text variant="meta" tone="muted" as="p">
            macOS will ask for access to the Slack keychain item.
          </Text>
        </div>
      </div>
      <div {...stylex.props(styles.status)} role="status" aria-live="polite">
        {waiting ? (
          <Text variant="ui" tone="muted" as="p">
            {busy === 'window' ? 'Waiting for the sign-in window' : 'Reading the Slack app’s session'}
          </Text>
        ) : error !== undefined ? (
          <Text variant="ui" tone="danger" as="p">
            {error}
          </Text>
        ) : null}
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
  actions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-4'],
  },
  secondary: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
  },
  status: {
    // Reserve a line so a message appearing never moves the buttons.
    minHeight: spacing['--space-6'],
  },
})
