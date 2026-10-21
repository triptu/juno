import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'
import { SignInPage } from './SignInPage'

export interface SignInViewProps {
  /** `first-run` has never signed in; `expired` had a session Slack no longer accepts. */
  readonly mode: 'first-run' | 'expired'
  /** The Slack app's session is being read. */
  readonly busy?: 'import'
  /** One short sentence about the last failed attempt. */
  readonly error?: string
  /** The failure has a report: a quiet "Copy details" button puts it on the clipboard. */
  readonly onCopyDetails?: () => void
  readonly onImport: () => void
}

/**
 * The page shown when there is no usable session: the mark, the serif
 * title, one primary action that reads the installed Slack app's session,
 * and a quiet line for what went wrong. This is the one surface where Juno speaks in the first person.
 */
export function SignInView({ mode, busy, error, onCopyDetails, onImport }: SignInViewProps) {
  const waiting = busy !== undefined
  const expired = mode === 'expired'
  const status = waiting
    ? { text: 'Reading the Slack app’s session', tone: 'muted' as const }
    : error === undefined
      ? undefined
      : { text: error, tone: 'danger' as const }
  return (
    <SignInPage
      titleId="sign-in-title"
      title={expired ? 'Slack signed you out' : "Hi, I'm Juno"}
      body={expired ? 'The Slack app’s session ended. Open Slack, sign in there, then try again. Your topics and settings are kept.' : "I'll use the Slack app on this Mac to sort your conversations into topics. Nothing is sent without you."}
      {...(status === undefined ? {} : { status })}
      {...(status?.tone === 'danger' && onCopyDetails !== undefined
        ? {
            statusAction: (
              <Button variant="ghost" size="xs" tone="subtle" onClick={onCopyDetails}>
                Copy details
              </Button>
            ),
          }
        : {})}
    >
      <div {...stylex.props(styles.actions)}>
        <Button variant="primary" size="2xl" onClick={onImport} disabled={waiting}>
          Use the Slack app's session
        </Button>
        <Text variant="meta" tone="muted" as="p">
          macOS will ask once for your Mac password so Juno can read Slack’s keychain item.
        </Text>
      </div>
    </SignInPage>
  )
}

const styles = stylex.create({
  actions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
  },
})
