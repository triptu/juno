import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'

export interface SessionViewProps {
  readonly teamName: string
  /** The user's handle, for example "alex". */
  readonly userName: string
  /** Enterprise Grid organisation, when there is one. */
  readonly enterpriseName?: string
  /** True while the sign-out runs. */
  readonly signingOut?: boolean
  readonly onSignOut: () => void
}

/** One quiet line saying which workspace is connected, and the way out. */
export function SessionView({ teamName, userName, enterpriseName, signingOut = false, onSignOut }: SessionViewProps) {
  const where = enterpriseName === undefined ? teamName : `${teamName} (${enterpriseName})`
  return (
    <section {...stylex.props(styles.section)} aria-label="Session">
      <Text variant="meta" tone="muted" as="p" role="status" aria-label="Session status">
        Signed in to {where} as {userName}
      </Text>
      <Button variant="ghost" size="sm" tone="muted" onClick={onSignOut} disabled={signingOut}>
        Sign out
      </Button>
    </section>
  )
}

const styles = stylex.create({
  section: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
})
