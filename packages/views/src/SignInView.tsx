import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'
import { SignInPage } from './SignInPage'

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
 * The page shown when there is no usable session: the mark, the serif
 * title, one primary action that opens Slack's sign-in, one secondary action
 * that reads the installed Slack app's session, and a quiet line for what
 * went wrong. This is the one surface where Juno speaks in the first person.
 */
export function SignInView({ mode, busy, error, onSignIn, onImport }: SignInViewProps) {
  const waiting = busy !== undefined
  const expired = mode === 'expired'
  const status = waiting
    ? { text: busy === 'window' ? 'Waiting for the sign-in window' : 'Reading the Slack app’s session', tone: 'muted' as const }
    : error === undefined
      ? undefined
      : { text: error, tone: 'danger' as const }
  return (
    <SignInPage
      titleId="sign-in-title"
      title={expired ? 'Slack signed you out' : "Hi, I'm Juno"}
      body={expired ? 'Sign in again to pick up where you left off. Your topics and settings are kept.' : "Sign in to Slack and I'll sort your conversations into topics. Nothing is sent without you."}
      {...(status === undefined ? {} : { status })}
    >
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
    </SignInPage>
  )
}

const styles = stylex.create({
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
})
